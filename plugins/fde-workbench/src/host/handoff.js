/**
 * Hand a workbench scope to a real DSH session.
 *
 * The session runs in a Workspace rooted at the workbench data directory, so
 * the agent can read the files named in the first message and write results
 * back. The plugin only creates and prompts; the conversation is the user's.
 */
import { randomUUID } from 'node:crypto'
import { WorkbenchError } from './paths.js'
import { ensureAgentsMd } from './agents-md.js'
import { renderHandoffPrompt, resolveScope } from './handoff-prompt.js'
import { trimToBytes } from './ai/context.js'

/** Run one handoff request. */
export function createHandoff(options) {
  const { ctx, config, store, files, logger } = options

  /**
   * Create or reuse the workspace, create a session, and send the context.
   * @param {object} request - `{ scope, locale, signal }`.
   */
  async function perform(request) {
    await ensureAgentsMd({ files, logger })
    const current = await store.read()
    const locale = request.locale === 'en' ? 'en' : 'zh'
    const scope = resolveScope(request.scope, current.state, locale)
    const rendered = renderHandoffPrompt({ root: config.root, scope, locale })
    const prompt = trimToBytes(rendered, config.limits.handoffBytes).text

    const controller = ctx.get?.('sessionController')
    if (controller === undefined || typeof controller.create !== 'function' || typeof controller.prompt !== 'function') {
      throw new WorkbenchError('handoff/unavailable', 503, 'session control is not composed in this profile')
    }

    let workspaceId = ''
    let workspaceError = ''
    if (config.handoff.groupInWorkspace) {
      const registry = ctx.get?.('workspaceRegistry')
      if (registry !== undefined && typeof registry.create === 'function') {
        try {
          const workspace = await registry.create(config.root, config.handoff.workspaceTitle)
          workspaceId = typeof workspace?.id === 'string' ? workspace.id : ''
        } catch (error) {
          workspaceError = error instanceof Error ? error.message : String(error)
          logger?.warn?.(`fde-workbench: workspace creation failed, falling back to cwd: ${workspaceError}`)
        }
      }
    }

    let created
    try {
      created = workspaceId === ''
        ? await controller.create({ cwd: config.root })
        : await controller.create({ workspaceId })
    } catch (error) {
      throw new WorkbenchError('handoff/create-failed', 502, 'could not create a workbench session', {
        cause: error instanceof Error ? error.message : String(error),
        workspaceId,
        workspaceError,
      })
    }
    const sessionId = created?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new WorkbenchError('handoff/create-failed', 502, 'session controller returned no session id')
    }

    const signal = request.signal ?? new AbortController().signal
    try {
      await controller.prompt({
        requestId: `fde-${randomUUID()}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
      }, signal)
    } catch (error) {
      throw new WorkbenchError('handoff/prompt-failed', 502, 'session was created but the context message failed', {
        cause: error instanceof Error ? error.message : String(error),
        sessionId,
        workspaceId,
        prompt,
      })
    }

    logger?.info?.(`fde-workbench: handed scope ${scope.kind} to session ${sessionId}`)
    return {
      sessionId,
      workspaceId,
      scope: { kind: scope.kind, id: scope.id, title: scope.title },
      files: scope.files,
      prompt,
      truncated: trimToBytes(rendered, config.limits.handoffBytes).truncated,
      workspaceFallback: workspaceId === '',
      workspaceError,
    }
  }

  return { perform }
}
