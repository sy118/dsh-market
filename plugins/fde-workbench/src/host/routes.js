/**
 * The authenticated workbench API.
 *
 * Every route is an exact Fetch route on DSH's shared `/api` channel, so the
 * transport has already checked the browser session and Host/Origin fence and
 * only the owner Peer reaches these handlers. Methods are limited to
 * GET/HEAD/POST by the carrier; writes are POSTs.
 */
import { AI_TASKS, SCHEMA_VERSION, TEXT_PREVIEW_BYTES } from '../shared/constants.js'
import { stageDefinition } from '../shared/stages.js'
import { WorkbenchError } from './paths.js'
import { applyMutation } from './state.js'
import { legacyToState } from './migrate.js'
import { emptyState, newId } from './schema.js'
import { hashText } from './files.js'

/** Route prefix; the carrier requires an absolute path below `/api`. */
export const API_PREFIX = '/api/fde-workbench'

/** JSON response with no caching. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Convert any thrown value into the stable client error shape. */
export function toErrorResponse(error, logger) {
  if (error instanceof WorkbenchError) {
    return json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    }, error.status)
  }
  logger?.warn?.(`fde-workbench: unhandled route error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  return json({ error: { code: 'internal', message: 'internal workbench error' } }, 500)
}

/** Read a JSON body with the configured cap. */
async function readJson(request, limit) {
  let text
  try {
    text = await request.text()
  } catch {
    throw new WorkbenchError('request/unreadable', 400, 'request body could not be read')
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > limit) {
    throw new WorkbenchError('request/too-large', 413, 'request body exceeds the configured limit', {
      bytes,
      limit,
    })
  }
  if (text.trim() === '') throw new WorkbenchError('request/empty', 400, 'request body is empty')
  try {
    return JSON.parse(text)
  } catch {
    throw new WorkbenchError('request/invalid-json', 400, 'request body is not valid JSON')
  }
}

/** Read the `path` query parameter. */
function queryPath(request) {
  const path = new URL(request.url).searchParams.get('path')
  if (path === null || path === '') throw new WorkbenchError('file/path-required', 400, 'path query parameter is required')
  return path
}

/** Read one required query parameter. */
function queryValue(request, name) {
  const value = new URL(request.url).searchParams.get(name)
  if (value === null || value === '') throw new WorkbenchError('request/query-required', 400, `${name} query parameter is required`)
  return value
}

/** Find one project in a snapshot. */
function projectIn(state, projectId) {
  const project = (state.projects ?? []).find(item => item.id === projectId)
  if (project === undefined) throw new WorkbenchError('project/not-found', 404, 'project was not found', { projectId })
  return project
}

/** Find one stage in a project. */
function stageIn(project, stageIndex) {
  const index = Number(stageIndex)
  if (!Number.isInteger(index) || index < 0 || index >= project.stages.length) {
    throw new WorkbenchError('stage/invalid', 400, 'stage must be an integer between 0 and 7', { stage: stageIndex })
  }
  return { index, stage: project.stages[index] }
}

/** Safe storage name for an uploaded file. */
function safeName(value) {
  const name = typeof value === 'string' ? value.split(/[\\/]/).at(-1) ?? '' : ''
  const cleaned = name.replace(/[^\p{L}\p{N}._ -]/gu, '_').trim().slice(0, 120)
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'upload.bin' : cleaned
}

/** Whether a MIME type has a text preview. */
function isTextMime(mime) {
  return typeof mime === 'string' && (mime.startsWith('text/') || mime === 'application/json')
}

/** Await bootstrap without letting a failed self-check hide the error. */
async function settled(runtime) {
  if (runtime?.ready === undefined) return
  try {
    await runtime.ready
  } catch {
    /* the error is surfaced through runtime.error */
  }
}

/** Refuse writes when the startup self-check could not prepare the root. */
function assertWritable(runtime) {
  if (runtime?.error !== undefined && runtime?.error !== null) {
    throw new WorkbenchError('root/unavailable', 503, 'the workbench data root is not usable', {
      cause: runtime.error instanceof Error ? runtime.error.message : String(runtime.error),
    })
  }
}

/**
 * Build the routes. Handlers close over the host services, so tests can pass
 * fakes without a Cordis context.
 * @param {object} options - store, files, ai, handoff, config, logger, runtime.
 */
export function createRouter(options) {
  const { store, files, ai, handoff, config, logger, runtime = {} } = options
  let aiBusy = false

  /** GET /state */
  async function getState() {
    await settled(runtime)
    if (runtime.error !== undefined && runtime.error !== null) {
      return json({
        state: emptyState(),
        readOnly: true,
        warnings: [...(runtime.warnings ?? [])],
        recovered: false,
        root: config.root,
        ai: { available: false, provider: '', model: '', reason: 'ai/unavailable' },
        schemaVersion: SCHEMA_VERSION,
        migration: { legacyImportedAt: null, legacySchema: null },
        rootError: {
          code: 'root/unavailable',
          message: runtime.error instanceof Error ? runtime.error.message : String(runtime.error),
        },
      })
    }
    const current = await store.read()
    let aiStatus
    try {
      aiStatus = await ai.status()
    } catch (error) {
      aiStatus = { available: false, reason: 'ai/unavailable', provider: '', model: '' }
      logger?.warn?.(`fde-workbench: ai status failed: ${String(error)}`)
    }
    return json({
      state: current.state,
      readOnly: current.readOnly,
      warnings: [...(current.warnings ?? []), ...(runtime.warnings ?? [])],
      recovered: current.recovered === true,
      root: config.root,
      ai: aiStatus,
      schemaVersion: SCHEMA_VERSION,
      migration: current.state.migration,
      rootError: null,
    })
  }

  /** POST /mutate */
  async function mutate(request) {
    assertWritable(runtime)
    const body = await readJson(request, config.limits.requestBytes)
    if (body === null || typeof body !== 'object') {
      throw new WorkbenchError('request/invalid', 400, 'body must be an object')
    }
    let outcome
    const changed = await store.mutate(
      Number.isInteger(body.baseRevision) ? body.baseRevision : null,
      async state => {
        outcome = await applyMutation(state, body.mutation, {
          files,
          locale: body.locale === 'en' ? 'en' : 'zh',
        })
        return outcome
      },
    )
    return json({
      state: changed.state,
      revision: changed.state.revision,
      result: outcome ?? null,
      warnings: changed.warnings ?? [],
    })
  }

  /** GET /file */
  async function readFile(request) {
    assertWritable(runtime)
    const path = queryPath(request)
    try {
      return json(await files.read(path))
    } catch (error) {
      // A body that was never written is a normal empty state, not a failure;
      // the hash of the empty string keeps the editor's save guard correct.
      if (error instanceof WorkbenchError && error.code === 'file/not-found') {
        return json({ path, text: '', hash: hashText(''), bytes: 0, missing: true })
      }
      throw error
    }
  }

  /** POST /file */
  async function writeFile(request) {
    assertWritable(runtime)
    const path = queryPath(request)
    const body = await readJson(request, config.limits.requestBytes)
    const content = typeof body.content === 'string' ? body.content : undefined
    if (content === undefined) throw new WorkbenchError('file/invalid', 400, 'content must be a string')
    const written = await files.write(path, content, typeof body.baseHash === 'string' ? body.baseHash : null)
    return json(written)
  }

  /** GET /project */
  async function getProject(request) {
    await settled(runtime)
    assertWritable(runtime)
    const projectId = queryValue(request, 'id')
    const current = await store.read()
    return json({ project: projectIn(current.state, projectId) })
  }

  /** GET /stage */
  async function getStage(request) {
    await settled(runtime)
    assertWritable(runtime)
    const projectId = queryValue(request, 'projectId')
    const current = await store.read()
    const project = projectIn(current.state, projectId)
    const { index, stage } = stageIn(project, queryValue(request, 'stage'))
    return json({ stage: { ...stage, index } })
  }

  /** GET /artifact — read one fixed deliverable by stage + artifact id. */
  async function readArtifact(request) {
    await settled(runtime)
    assertWritable(runtime)
    const projectId = queryValue(request, 'projectId')
    const current = await store.read()
    const project = projectIn(current.state, projectId)
    const { index } = stageIn(project, queryValue(request, 'stage'))
    const artifactId = queryValue(request, 'artifactId')
    const definition = stageDefinition(index).artifacts.find(item => item.id === artifactId)
    if (definition === undefined) {
      throw new WorkbenchError('artifact/not-found', 404, 'unknown deliverable for this stage', { artifactId })
    }
    const inspected = await files.inspect(`projects/${project.id}/${definition.path}`)
    if (inspected.status === 'error') {
      throw new WorkbenchError('artifact/unreadable', 422, 'deliverable could not be read', {
        path: definition.path,
        message: inspected.error,
      })
    }
    if (inspected.status === 'missing') {
      return json({ path: definition.path, text: '', hash: inspected.hash, bytes: inspected.bytes, missing: true })
    }
    const read = await files.read(`projects/${project.id}/${definition.path}`)
    return json({ ...read, missing: false })
  }

  /** POST /source — one base64 upload; the file is written before metadata. */
  async function uploadSource(request) {
    assertWritable(runtime)
    const body = await readJson(request, config.limits.sourceRequestBytes)
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    const name = typeof body.name === 'string' ? body.name : ''
    if (projectId === '' || name.trim() === '') {
      throw new WorkbenchError('source/invalid', 400, 'projectId and name are required')
    }
    const raw = typeof body.dataBase64 === 'string' ? body.dataBase64.replace(/\s+/g, '') : ''
    if (raw === '' || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
      throw new WorkbenchError('source/invalid-base64', 400, 'dataBase64 is not valid base64')
    }
    const buffer = Buffer.from(raw, 'base64')
    if (buffer.byteLength > config.limits.sourceBytes) {
      throw new WorkbenchError('source/too-large', 413, 'source exceeds the configured size', {
        bytes: buffer.byteLength,
        limit: config.limits.sourceBytes,
      })
    }
    const current = await store.read()
    const project = projectIn(current.state, projectId)
    const sourceId = typeof body.sourceId === 'string' && /^f-[a-z0-9]+$/.test(body.sourceId)
      ? body.sourceId
      : newId('f')
    const existing = project.sources.find(item => item.id === sourceId)
    const version = existing === undefined ? 1 : existing.version + 1
    const path = `projects/${project.id}/sources/${sourceId}/${version}/${safeName(name)}`
    const written = await files.writeBinary(path, buffer)
    try {
      const changed = await store.mutate(current.state.revision, state => applyMutation(state, {
        op: 'source.add',
        projectId: project.id,
        sourceId,
        name,
        mime: typeof body.mime === 'string' && body.mime !== '' ? body.mime : 'application/octet-stream',
        bytes: written.bytes,
        sha256: written.hash,
        version,
        path,
      }, { files, locale: body.locale === 'en' ? 'en' : 'zh' }))
      const next = projectIn(changed.state, project.id)
      return json({
        state: changed.state,
        revision: changed.state.revision,
        result: changed.result,
        source: next.sources.find(item => item.id === sourceId) ?? null,
      })
    } catch (error) {
      await files.remove(path)
      throw error
    }
  }

  /** GET /source — metadata plus a bounded text preview when possible. */
  async function readSource(request) {
    await settled(runtime)
    assertWritable(runtime)
    const projectId = queryValue(request, 'projectId')
    const sourceId = queryValue(request, 'id')
    const current = await store.read()
    const project = projectIn(current.state, projectId)
    const source = project.sources.find(item => item.id === sourceId)
    if (source === undefined) throw new WorkbenchError('source/not-found', 404, 'source was not found', { sourceId })
    if (!isTextMime(source.mime)) {
      return json({ source, preview: { available: false, text: '', truncated: false } })
    }
    const read = await files.readBinary(source.path, config.limits.sourceBytes)
    const slice = read.buffer.subarray(0, TEXT_PREVIEW_BYTES)
    return json({
      source,
      preview: {
        available: true,
        text: slice.toString('utf8'),
        truncated: read.buffer.byteLength > TEXT_PREVIEW_BYTES,
      },
    })
  }

  /** GET /source/file — original bytes, resolved from metadata only. */
  async function downloadSource(request) {
    await settled(runtime)
    assertWritable(runtime)
    const projectId = queryValue(request, 'projectId')
    const sourceId = queryValue(request, 'id')
    const current = await store.read()
    const project = projectIn(current.state, projectId)
    const source = project.sources.find(item => item.id === sourceId)
    if (source === undefined) throw new WorkbenchError('source/not-found', 404, 'source was not found', { sourceId })
    const read = await files.readBinary(source.path, config.limits.sourceBytes)
    return new Response(new Uint8Array(read.buffer), {
      status: 200,
      headers: {
        'content-type': source.mime,
        'content-length': String(read.bytes),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  }

  /** POST /ai — Server-Sent Events with start/delta/result/error/done. */
  async function streamAi(request) {
    assertWritable(runtime)
    if (aiBusy) throw new WorkbenchError('ai/busy', 429, 'another AI request is already running')
    const body = await readJson(request, config.limits.aiRequestBytes)
    const task = body.task
    if (!AI_TASKS.includes(task)) throw new WorkbenchError('ai/task', 400, `unknown AI task ${String(task)}`)
    const status = await ai.status()
    if (!status.available) {
      throw new WorkbenchError('ai/unavailable', 503, 'AI is not available in this deployment', { reason: status.reason })
    }
    aiBusy = true
    const encoder = new TextEncoder()
    const abort = new AbortController()
    const relay = () => abort.abort()
    if (request.signal !== undefined) request.signal.addEventListener('abort', relay, { once: true })
    let closed = false
    let controllerRef
    const send = event => {
      if (closed) return
      try {
        controllerRef.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch {
        closed = true
      }
    }
    const finish = () => {
      if (closed) return
      closed = true
      try {
        controllerRef.close()
      } catch {
        /* the consumer may already be gone */
      }
    }
    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller
        send({ type: 'start', task, route: { provider: status.provider, model: status.model } })
        ai.run({
          task,
          payload: body.payload ?? {},
          locale: body.locale === 'en' ? 'en' : 'zh',
          signal: abort.signal,
          onDelta(text) {
            send({ type: 'delta', text })
          },
        }).then(result => {
          send({
            type: 'result',
            result: result.result,
            invalid: result.invalid,
            route: result.route,
            files: result.files,
            truncated: result.truncated,
          })
          send({ type: 'done' })
          finish()
        }).catch(error => {
          const code = error instanceof WorkbenchError ? error.code : 'ai/failed'
          const message = error instanceof Error ? error.message : String(error)
          send({
            type: 'error',
            code,
            message,
            text: error?.details?.text ?? '',
            invalid: error?.details?.invalid ?? [],
            reason: error?.details?.reason,
            cause: error?.details?.cause,
          })
          finish()
        }).finally(() => {
          aiBusy = false
          if (request.signal !== undefined) request.signal.removeEventListener('abort', relay)
        })
      },
      cancel() {
        closed = true
        abort.abort()
        aiBusy = false
      },
    })
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  }

  /** POST /handoff */
  async function handoffRoute(request) {
    assertWritable(runtime)
    const body = await readJson(request, config.limits.requestBytes)
    const result = await handoff.perform({
      scope: body.scope ?? { kind: 'workspace' },
      locale: body.locale === 'en' ? 'en' : 'zh',
      signal: request.signal,
    })
    return json(result)
  }

  /** POST /legacy-import */
  async function legacyImport(request) {
    assertWritable(runtime)
    const body = await readJson(request, config.limits.requestBytes)
    const current = await store.read()
    if (current.state.migration.legacyImportedAt !== null) {
      return json({ alreadyImported: true, counts: null, state: current.state })
    }
    const snapshot = body.state ?? body
    const converted = legacyToState(snapshot, { locale: body.locale === 'en' ? 'en' : 'zh' })
    for (const file of converted.files) {
      await files.write(file.path, file.text, null)
    }
    const replaced = await store.replace(
      Number.isInteger(body.baseRevision) ? body.baseRevision : null,
      converted.state,
    )
    logger?.info?.(`fde-workbench: imported legacy state (${converted.counts.projects} projects)`)
    return json({
      alreadyImported: false,
      counts: converted.counts,
      state: replaced.state,
    })
  }

  /** Wrap one handler with error mapping. */
  function handler(routeHandler) {
    return async request => {
      try {
        return await routeHandler(request)
      } catch (error) {
        return toErrorResponse(error, logger)
      }
    }
  }

  const routes = [
    { path: `${API_PREFIX}/state`, methods: ['GET'], requestBody: 'buffered', fetch: handler(getState) },
    { path: `${API_PREFIX}/mutate`, methods: ['POST'], requestBody: 'buffered', fetch: handler(mutate) },
    { path: `${API_PREFIX}/project`, methods: ['GET'], requestBody: 'buffered', fetch: handler(getProject) },
    { path: `${API_PREFIX}/stage`, methods: ['GET'], requestBody: 'buffered', fetch: handler(getStage) },
    { path: `${API_PREFIX}/artifact`, methods: ['GET'], requestBody: 'buffered', fetch: handler(readArtifact) },
    { path: `${API_PREFIX}/file`, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: handler(request => (request.method === 'GET' ? readFile(request) : writeFile(request))) },
    { path: `${API_PREFIX}/source`, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: handler(request => (request.method === 'GET' ? readSource(request) : uploadSource(request))) },
    { path: `${API_PREFIX}/source/file`, methods: ['GET'], requestBody: 'buffered', fetch: handler(downloadSource) },
    { path: `${API_PREFIX}/ai`, methods: ['POST'], requestBody: 'buffered', fetch: handler(streamAi) },
    { path: `${API_PREFIX}/handoff`, methods: ['POST'], requestBody: 'buffered', fetch: handler(handoffRoute) },
    { path: `${API_PREFIX}/legacy-import`, methods: ['POST'], requestBody: 'buffered', fetch: handler(legacyImport) },
  ]

  return { routes }
}

/**
 * Register every route on the host Connection service.
 * @param {object} ctx - host context providing `connection.fetch`.
 * @param {object} router - result of `createRouter`.
 * @returns {Array<() => Promise<void>>} disposers.
 */
export function registerRoutes(ctx, router) {
  const registry = ctx.connection?.fetch
  if (registry === undefined || typeof registry.register !== 'function') {
    throw new Error('fde-workbench: ctx.connection.fetch is not available')
  }
  return router.routes.map(route => registry.register(route))
}
