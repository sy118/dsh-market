/**
 * One AI request: resolve the route, read the records, stream the answer, then
 * validate the structured result. The service never writes records; the route
 * returns a proposal the user applies explicitly.
 */
import { AI_TASKS, STRUCTURED_TASKS } from '../../shared/constants.js'
import { WorkbenchError } from '../paths.js'
import { describeAi } from './capabilities.js'
import { buildCappedContext } from './context.js'
import { parseTaskResult } from './parse.js'
import { buildPrompt } from './prompts.js'

/** Map provider failures to a stable client-facing error. */
function mapLlmError(error, route) {
  if (error instanceof WorkbenchError) return error
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'MISSING_CREDENTIAL' || code === 'NO_ADAPTER' || code === 'MODEL_NOT_FOUND') {
    return new WorkbenchError('ai/unavailable', 503, message, { cause: code, ...route })
  }
  return new WorkbenchError('ai/failed', 502, message, { cause: code === '' ? undefined : code, ...route })
}

/**
 * Create the AI facade used by the routes.
 * @param {object} options - context, config, store, files, logger.
 */
export function createAiService(options) {
  const { ctx, config, store, files, logger } = options
  /** Set after a provider rejects the route for a missing credential. */
  let credentialFailure = null

  /** Current availability and route, as shown in the panel. */
  async function status() {
    const found = await describeAi({ ctx, config })
    if (
      found.available
      && credentialFailure !== null
      && credentialFailure.provider === found.provider
      && credentialFailure.model === found.model
    ) {
      return {
        ...found,
        available: false,
        reason: 'ai/missing-credential',
        timeoutMs: config.ai.timeoutMs,
        maxTokens: config.ai.maxTokens,
      }
    }
    return {
      ...found,
      timeoutMs: config.ai.timeoutMs,
      maxTokens: config.ai.maxTokens,
    }
  }

  /**
   * Run one task.
   * @param {object} request - `{ task, payload, locale, signal, onDelta }`.
   */
  async function run(request) {
    const task = request.task
    if (!AI_TASKS.includes(task)) throw new WorkbenchError('ai/task', 400, `unknown AI task ${String(task)}`)
    const route = await describeAi({ ctx, config })
    if (!route.available) {
      throw new WorkbenchError('ai/unavailable', 503, 'AI is not available in this deployment', {
        reason: route.reason,
      })
    }
    const current = await store.read()
    const locale = request.locale === 'en' ? 'en' : 'zh'
    const context = await buildCappedContext(task, request.payload ?? {}, {
      state: current.state,
      files,
      locale,
      limit: config.limits.aiRequestBytes,
    })
    const prompt = buildPrompt(task, { contextText: context.contextText, locale })
    const llm = ctx.get('llm')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, config.ai.timeoutMs)
    const relay = () => controller.abort()
    if (request.signal !== undefined) request.signal.addEventListener('abort', relay, { once: true })
    let text = ''
    let reasoning = ''
    let finish
    try {
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        system: prompt.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
        maxTokens: config.ai.maxTokens,
        temperature: config.ai.temperature,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
          if (typeof request.onDelta === 'function') request.onDelta(chunk.text)
        } else if (chunk.type === 'reasoning-delta') {
          reasoning += chunk.text
        } else if (chunk.type === 'finish') {
          finish = chunk.reason
        }
      }
    } catch (error) {
      if (timedOut) {
        throw new WorkbenchError('ai/timeout', 408, 'the model did not answer in time', {
          timeoutMs: config.ai.timeoutMs,
          text,
        })
      }
      if (request.signal?.aborted === true) {
        throw new WorkbenchError('ai/cancelled', 499, 'the request was cancelled', { text })
      }
      const mapped = mapLlmError(error, { provider: route.provider, model: route.model })
      if (mapped.details?.cause === 'MISSING_CREDENTIAL') {
        credentialFailure = { provider: route.provider, model: route.model }
      }
      throw mapped
    } finally {
      clearTimeout(timer)
      if (request.signal !== undefined) request.signal.removeEventListener('abort', relay)
    }
    credentialFailure = null

    if (finish?.kind === 'error') {
      const failure = finish.failure ?? {}
      const cause = typeof failure.code === 'string' ? failure.code : undefined
      if (cause === 'MISSING_CREDENTIAL') credentialFailure = { provider: route.provider, model: route.model }
      throw new WorkbenchError(cause === 'MISSING_CREDENTIAL' ? 'ai/unavailable' : 'ai/failed', cause === 'MISSING_CREDENTIAL' ? 503 : 502, 'the provider ended the stream with an error', {
        cause,
        text,
        reasoning: reasoning !== '',
      })
    }
    if (finish?.kind === 'max-tokens' && text.trim() === '') {
      throw new WorkbenchError('ai/truncated', 422, 'the model reached its output limit before answering', {
        text,
        reasoning: reasoning !== '',
        maxTokens: config.ai.maxTokens,
      })
    }
    if (text.trim() === '') {
      throw new WorkbenchError('ai/empty', 422, 'the model returned no text', {
        text,
        reasoning: reasoning !== '',
      })
    }

    const parsed = parseTaskResult(task, text, STRUCTURED_TASKS.has(task))
    if (parsed.error !== null) {
      throw new WorkbenchError(parsed.error, 422, 'the model answer could not be parsed', {
        text,
        invalid: parsed.invalid,
        task,
      })
    }
    if (task === 'doc.draft' && parsed.result !== null && typeof parsed.result.markdown === 'string') {
      if (!parsed.result.markdown.startsWith('#')) {
        const title = typeof request.payload?.title === 'string' ? request.payload.title : 'Document'
        parsed.result.markdown = `# ${title}\n\n${parsed.result.markdown}`
      }
    }
    logger?.info?.(`fde-workbench: ai ${task} finished (${text.length} chars)`)
    return {
      task,
      text,
      result: parsed.result,
      invalid: parsed.invalid,
      route: { provider: route.provider, model: route.model, modelName: route.modelName ?? route.model },
      files: context.files,
      truncated: context.truncated,
    }
  }

  return { status, run }
}
