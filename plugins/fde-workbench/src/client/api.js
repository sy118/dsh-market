/**
 * Browser client for the workbench API.
 *
 * All calls are same-origin POST/GET requests; the host owns authentication.
 * Errors carry the host's stable code so the panel can translate them, and the
 * AI call parses the Server-Sent Events stream into typed callbacks.
 */

const API_PATH = 'api/fde-workbench/'

/** A failed API call, with the host's code and HTTP status. */
export class ApiError extends Error {
  /**
   * @param {string} code - stable code such as `state/conflict`.
   * @param {string} message - developer-facing message.
   * @param {number} status - HTTP status.
   * @param {object} [details] - structured details from the host.
   */
  constructor(code, message, status, details) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** Resolve one endpoint against the page base. */
export function endpointOf(path) {
  const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI
  return new URL(`${API_PATH}${path.replace(/^\//, '')}`, base).toString()
}

/** Parse a JSON response body, or throw an ApiError. */
async function decode(response) {
  const text = await response.text()
  let body
  try {
    body = text === '' ? {} : JSON.parse(text)
  } catch {
    throw new ApiError('response/invalid-json', 'the host returned invalid JSON', response.status)
  }
  if (!response.ok) {
    const error = body?.error ?? {}
    throw new ApiError(error.code ?? `http/${response.status}`, error.message ?? 'request failed', response.status, error.details)
  }
  return body
}

/** One JSON request. */
async function request(path, options = {}) {
  const init = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {},
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  if (options.body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }
  let response
  try {
    response = await fetch(endpointOf(path), init)
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError('network/failed', error instanceof Error ? error.message : String(error), 0)
  }
  return decode(response)
}

/** Parse one SSE block into a JSON event. */
export function parseEventBlock(block) {
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (data.length === 0) return null
  try {
    return JSON.parse(data.join('\n'))
  } catch {
    return null
  }
}

/** Read one SSE response and dispatch every event. */
export async function readEventStream(response, onEvent) {
  if (response.body === null) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const event = parseEventBlock(block)
      if (event !== null) onEvent(event)
      index = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  const tail = buffer.trim()
  if (tail !== '') {
    const event = parseEventBlock(tail)
    if (event !== null) onEvent(event)
  }
}

/** Read the full state. */
export function getState() {
  return request('state')
}

/** Apply one mutation. */
export function mutate(baseRevision, mutation, locale) {
  return request('mutate', {
    method: 'POST',
    body: { baseRevision, mutation, locale },
  })
}

/** Read one Markdown body. */
export function readFile(path) {
  return request(`file?path=${encodeURIComponent(path)}`)
}

/** Write one Markdown body, optionally guarded by the hash it was read at. */
export function writeFile(path, content, baseHash) {
  return request(`file?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: { content, baseHash },
  })
}

/** Read one project. */
export function readProject(id) {
  return request(`project?id=${encodeURIComponent(id)}`)
}

/** Read one stage. */
export function readStage(projectId, stage) {
  return request(`stage?projectId=${encodeURIComponent(projectId)}&stage=${encodeURIComponent(String(stage))}`)
}

/** Read one fixed stage deliverable by its stable id. */
export function readArtifact(projectId, stage, artifactId) {
  return request(`artifact?projectId=${encodeURIComponent(projectId)}&stage=${encodeURIComponent(String(stage))}&artifactId=${encodeURIComponent(artifactId)}`)
}

/** Upload one source file as base64. */
export function uploadSource(projectId, file, locale) {
  return request('source', {
    method: 'POST',
    body: {
      projectId,
      sourceId: file.sourceId,
      name: file.name,
      mime: file.mime,
      dataBase64: file.dataBase64,
      locale,
    },
  })
}

/** Read source metadata and an optional bounded text preview. */
export function readSource(projectId, sourceId) {
  return request(`source?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(sourceId)}`)
}

/** Same-origin URL for the original source bytes. */
export function sourceFileUrl(projectId, sourceId) {
  return endpointOf(`source/file?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(sourceId)}`)
}

/** Import the legacy browser snapshot once. */
export function legacyImport(state, baseRevision, locale) {
  return request('legacy-import', {
    method: 'POST',
    body: { state, baseRevision, locale },
  })
}

/** Create a workbench session and send the first message. */
export function handoff(scope, locale, signal) {
  return request('handoff', {
    method: 'POST',
    body: { scope, locale },
    signal,
  })
}

/**
 * Run one AI task and dispatch stream events.
 * @param {object} input - `{ task, payload, locale, signal, onEvent }`.
 */
export async function aiStream(input) {
  let response
  try {
    response = await fetch(endpointOf('ai'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: input.task, payload: input.payload ?? {}, locale: input.locale }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError('network/failed', error instanceof Error ? error.message : String(error), 0)
  }
  if (!response.ok) {
    let body
    try {
      body = await response.json()
    } catch {
      throw new ApiError(`http/${response.status}`, 'request failed', response.status)
    }
    const error = body?.error ?? {}
    throw new ApiError(error.code ?? `http/${response.status}`, error.message ?? 'request failed', response.status, error.details)
  }
  let failure
  let final
  await readEventStream(response, event => {
    if (event.type === 'error') {
      failure = new ApiError(event.code ?? 'ai/failed', event.message ?? 'AI failed', 200, {
        text: event.text,
        invalid: event.invalid,
        reason: event.reason,
        cause: event.cause,
      })
    }
    if (event.type === 'result') final = event
    input.onEvent?.(event)
  })
  if (failure !== undefined) throw failure
  return final
}

/** Expose the serializer for tests and diagnostics. */
export const __testing = { request, decode }
