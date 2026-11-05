/** The authenticated /api/fde-workbench routes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRouter, registerRoutes } from '../src/host/routes.js'
import { WorkbenchStore } from '../src/host/store.js'
import { WorkbenchFiles } from '../src/host/files.js'
import { resolveConfig } from '../src/host/config.js'
import { createHandoff } from '../src/host/handoff.js'
import { legacyFixture, hostFixture } from './helpers.mjs'

const BASE = 'http://localhost/api/fde-workbench'

/** Fake AI facade for routes that only touch availability or a canned answer. */
function fakeAi(overrides = {}) {
  const calls = []
  return {
    calls,
    status: async () => overrides.status ?? { available: true, provider: 'deepseek', model: 'deepseek-chat', reason: null },
    run: overrides.run ?? (async request => {
      calls.push(request)
      request.onDelta?.('one ')
      request.onDelta?.('two')
      return {
        task: request.task,
        text: 'one two',
        result: { candidates: [] },
        invalid: [],
        route: { provider: 'deepseek', model: 'deepseek-chat', modelName: 'DeepSeek' },
        files: ['meetings/m-1.md'],
        truncated: false,
      }
    }),
  }
}

/** Build a router over a temporary host fixture. */
async function routerFixture(t, aiOverrides = {}) {
  const fixture = await hostFixture(t)
  const ai = fakeAi(aiOverrides)
  const handoff = createHandoff({
    ctx: { get: () => undefined },
    config: fixture.config,
    store: fixture.store,
    files: fixture.files,
    logger: { info() {}, warn() {} },
  })
  const router = createRouter({
    store: fixture.store,
    files: fixture.files,
    ai,
    handoff,
    config: fixture.config,
    logger: { info() {}, warn() {} },
    runtime: { ready: Promise.resolve(), warnings: [], error: null },
  })
  return { ...fixture, ai, router }
}

/** Find one route by suffix. */
function routeOf(router, suffix) {
  const route = router.routes.find(item => item.path.endsWith(suffix))
  assert.ok(route !== undefined, `missing route ${suffix}`)
  return route
}

/** POST JSON to a route. */
function post(path, body) {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('routes: registers only authenticated paths and allowed methods', async t => {
  const { router } = await routerFixture(t)
  assert.deepEqual(router.routes.map(item => item.path).sort(), [
    '/api/fde-workbench/ai',
    '/api/fde-workbench/artifact',
    '/api/fde-workbench/file',
    '/api/fde-workbench/handoff',
    '/api/fde-workbench/legacy-import',
    '/api/fde-workbench/mutate',
    '/api/fde-workbench/project',
    '/api/fde-workbench/source',
    '/api/fde-workbench/source/file',
    '/api/fde-workbench/stage',
    '/api/fde-workbench/state',
  ])
  for (const route of router.routes) {
    assert.ok(route.path.startsWith('/api/fde-workbench/'))
    assert.equal(route.requestBody, 'buffered')
    for (const method of route.methods) assert.ok(['GET', 'HEAD', 'POST'].includes(method))
  }
  const registered = []
  const removed = []
  const disposers = registerRoutes({
    connection: { fetch: { register(route) { registered.push(route.path); return async () => { removed.push(route.path) } } } },
  }, router)
  assert.equal(registered.length, 11)
  await Promise.all(disposers.map(dispose => dispose()))
  assert.equal(removed.length, 11)
})

test('routes: state returns the root, revision, ai status, and migration', async t => {
  const { router, root } = await routerFixture(t)
  const response = await routeOf(router, '/state').fetch(new Request(`${BASE}/state`))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.root, root)
  assert.equal(body.state.revision, 0)
  assert.equal(body.ai.available, true)
  assert.equal(body.schemaVersion, 2)
  assert.equal(body.readOnly, false)
})

test('routes: mutate creates a project and reports a stale revision', async t => {
  const { router } = await routerFixture(t)
  const ok = await routeOf(router, '/mutate').fetch(post('/mutate', {
    baseRevision: 0,
    mutation: { op: 'project.create', name: '应付账款对账' },
    locale: 'zh',
  }))
  assert.equal(ok.status, 200)
  const created = await ok.json()
  assert.equal(created.state.projects.length, 1)
  assert.equal(created.revision, 1)

  const conflict = await routeOf(router, '/mutate').fetch(post('/mutate', {
    baseRevision: 0,
    mutation: { op: 'project.create', name: '第二条' },
  }))
  assert.equal(conflict.status, 409)
  const body = await conflict.json()
  assert.equal(body.error.code, 'state/conflict')
  assert.equal(body.error.details.revision, 1)
})

test('routes: mutate rejects unknown operations and bad JSON', async t => {
  const { router } = await routerFixture(t)
  const unknown = await routeOf(router, '/mutate').fetch(post('/mutate', { mutation: { op: 'nope' } }))
  assert.equal(unknown.status, 400)
  assert.equal((await unknown.json()).error.code, 'mutation/unknown')

  const badJson = await routeOf(router, '/mutate').fetch(new Request(`${BASE}/mutate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  }))
  assert.equal(badJson.status, 400)
  assert.equal((await badJson.json()).error.code, 'request/invalid-json')
})

test('routes: file read and hash-guarded write', async t => {
  const { router, files } = await routerFixture(t)
  await files.write('projects/p-1/project.md', '# one\n', null)
  const read = await routeOf(router, '/file').fetch(new Request(`${BASE}/file?path=projects%2Fp-1%2Fproject.md`))
  assert.equal(read.status, 200)
  const first = await read.json()
  assert.equal(first.text, '# one\n')

  const written = await routeOf(router, '/file').fetch(post('/file?path=projects%2Fp-1%2Fproject.md', {
    content: '# two\n',
    baseHash: first.hash,
  }))
  assert.equal(written.status, 200)
  assert.equal((await files.read('projects/p-1/project.md')).text, '# two\n')

  const conflict = await routeOf(router, '/file').fetch(post('/file?path=projects%2Fp-1%2Fproject.md', {
    content: '# three\n',
    baseHash: first.hash,
  }))
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).error.code, 'file/conflict')

  const escape = await routeOf(router, '/file').fetch(new Request(`${BASE}/file?path=..%2Fescape.md`))
  assert.equal(escape.status, 400)

  const missing = await routeOf(router, '/file').fetch(new Request(`${BASE}/file?path=projects%2Fp-2%2Fstages%2F0.md`))
  assert.equal(missing.status, 200)
  const empty = await missing.json()
  assert.equal(empty.missing, true)
  assert.equal(empty.text, '')
  assert.equal(typeof empty.hash, 'string')
})

test('routes: mutation responses recompute the derived stage status', async t => {
  const { router } = await routerFixture(t)
  const mutateRoute = routeOf(router, '/mutate')
  const created = await mutateRoute.fetch(post('/mutate', {
    baseRevision: 0,
    mutation: { op: 'project.create', name: '状态刷新' },
  }))
  let body = await created.json()
  const projectId = body.state.projects[0].id
  const stage = body.state.projects[0].stages[0]
  for (const deliverable of stage.deliverables.filter(item => item.required)) {
    body = await (await mutateRoute.fetch(post('/mutate', {
      baseRevision: body.revision,
      mutation: {
        op: 'stage.deliverable.write',
        projectId,
        stage: 0,
        artifactId: deliverable.id,
        content: '# 证据\n',
      },
    }))).json()
  }
  for (const item of stage.work) {
    body = await (await mutateRoute.fetch(post('/mutate', {
      baseRevision: body.revision,
      mutation: { op: 'stage.work.toggle', projectId, stage: 0, workId: item.id, done: true },
    }))).json()
  }
  assert.equal(body.state.projects[0].stages[0].status, 'review-ready')
  assert.deepEqual(body.state.projects[0].stages[0].reviewBlockers, [])

  const decision = await mutateRoute.fetch(post('/mutate', {
    baseRevision: body.revision,
    mutation: { op: 'stage.decide', projectId, stage: 0, outcome: 'go', rationale: '齐备' },
  }))
  const next = await decision.json()
  assert.equal(next.state.projects[0].currentStage, 1)
  assert.equal(next.state.projects[0].stages[0].decisions.at(-1).outcome, 'go')
})

test('routes: error envelope covers 400, 404, 413, and 422', async t => {
  const { router } = await routerFixture(t)
  const bad = await routeOf(router, '/mutate').fetch(post('/mutate', { mutation: { op: 'nope' } }))
  assert.equal(bad.status, 400)

  const missing = await routeOf(router, '/artifact').fetch(new Request(`${BASE}/artifact?projectId=p-x&stage=0&artifactId=discovery-report`))
  assert.equal(missing.status, 404)

  const tooLarge = await routeOf(router, '/mutate').fetch(post('/mutate', {
    mutation: { op: 'project.create', name: 'x' },
    padding: 'x'.repeat(1_100_000),
  }))
  assert.equal(tooLarge.status, 413)

  const created = await routeOf(router, '/mutate').fetch(post('/mutate', { baseRevision: 0, mutation: { op: 'project.create', name: '未就绪' } }))
  const state = (await created.json()).state
  const projectId = state.projects[0].id
  const notReady = await routeOf(router, '/mutate').fetch(post('/mutate', {
    baseRevision: state.revision,
    mutation: { op: 'stage.decide', projectId, stage: 0, outcome: 'go', rationale: '太早' },
  }))
  assert.equal(notReady.status, 422)
  assert.equal((await notReady.json()).error.code, 'stage/not-ready')
})

test('routes: artifact read resolves fixed ids and source upload/preview works', async t => {
  const { router } = await routerFixture(t)
  const created = await routeOf(router, '/mutate').fetch(post('/mutate', {
    baseRevision: 0,
    mutation: { op: 'project.create', name: '资料项目' },
  }))
  const state = (await created.json()).state
  const projectId = state.projects[0].id

  const missing = await routeOf(router, '/artifact').fetch(new Request(`${BASE}/artifact?projectId=${projectId}&stage=0&artifactId=discovery-report`))
  assert.equal(missing.status, 200)
  assert.equal((await missing.json()).missing, true)

  const bad = await routeOf(router, '/artifact').fetch(new Request(`${BASE}/artifact?projectId=${projectId}&stage=0&artifactId=..%2Fescape`))
  assert.equal(bad.status, 404)

  const payload = Buffer.from('# 现场记录\n\n客户访谈。\n', 'utf8').toString('base64')
  const uploaded = await routeOf(router, '/source').fetch(post('/source', {
    projectId,
    name: '访谈.md',
    mime: 'text/markdown',
    dataBase64: payload,
  }))
  assert.equal(uploaded.status, 200)
  const body = await uploaded.json()
  assert.equal(body.source.name, '访谈.md')
  assert.equal(body.source.bytes, Buffer.byteLength('# 现场记录\n\n客户访谈。\n'))
  assert.equal(body.source.version, 1)

  const preview = await routeOf(router, '/source').fetch(new Request(`${BASE}/source?projectId=${projectId}&id=${body.source.id}`))
  assert.equal(preview.status, 200)
  const previewBody = await preview.json()
  assert.equal(previewBody.preview.available, true)
  assert.ok(previewBody.preview.text.includes('客户访谈'))

  const download = await routeOf(router, '/source/file').fetch(new Request(`${BASE}/source/file?projectId=${projectId}&id=${body.source.id}`))
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('content-type'), 'text/markdown')
})

test('routes: legacy import is idempotent and writes bodies', async t => {
  const { router, root } = await routerFixture(t)
  const invalid = await routeOf(router, '/legacy-import').fetch(post('/legacy-import', { state: { version: 1 } }))
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error.code, 'migration/unsupported')

  const first = await routeOf(router, '/legacy-import').fetch(post('/legacy-import', {
    state: legacyFixture(),
    baseRevision: 0,
  }))
  assert.equal(first.status, 200)
  const body = await first.json()
  assert.equal(body.alreadyImported, false)
  assert.deepEqual(body.counts, { projects: 2, opportunities: 6, meetings: 2 })
  assert.ok(body.state.migration.legacyImportedAt !== null)
  const projectFile = await readFile(join(root, 'projects', 'p-alpha', 'project.md'), 'utf8')
  assert.ok(projectFile.includes('应付账款对账'))

  const second = await routeOf(router, '/legacy-import').fetch(post('/legacy-import', { state: legacyFixture() }))
  assert.equal(second.status, 200)
  assert.equal((await second.json()).alreadyImported, true)
})

test('routes: ai streams start/delta/result/done', async t => {
  const { router, ai } = await routerFixture(t)
  const response = await routeOf(router, '/ai').fetch(post('/ai', {
    task: 'meeting.extract',
    payload: { meetingId: 'm-1' },
    locale: 'zh',
  }))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const text = await response.text()
  const events = text.trim().split('\n\n').map(chunk => JSON.parse(chunk.replace(/^data: /, '')))
  assert.deepEqual(events.map(event => event.type), ['start', 'delta', 'delta', 'result', 'done'])
  assert.equal(events[1].text, 'one ')
  assert.equal(events[2].text, 'two')
  assert.equal(ai.calls.length, 1)
})

test('routes: ai is unavailable, unknown, or busy', async t => {
  const unavailable = await routerFixture(t, {
    status: { available: false, provider: '', model: '', reason: 'ai/no-llm' },
  })
  const response = await routeOf(unavailable.router, '/ai').fetch(post('/ai', { task: 'meeting.extract' }))
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.details.reason, 'ai/no-llm')

  const { router } = await routerFixture(t)
  const unknown = await routeOf(router, '/ai').fetch(post('/ai', { task: 'nope' }))
  assert.equal(unknown.status, 400)
  assert.equal((await unknown.json()).error.code, 'ai/task')

  let release
  const delayed = await routerFixture(t, {
    run: async request => {
      await new Promise(resolve => { release = resolve })
      return { task: request.task, text: '', result: {}, invalid: [], route: {}, files: [], truncated: false }
    },
  })
  const first = await routeOf(delayed.router, '/ai').fetch(post('/ai', { task: 'assistant.chat', payload: {} }))
  const second = await routeOf(delayed.router, '/ai').fetch(post('/ai', { task: 'assistant.chat', payload: {} }))
  assert.equal(second.status, 429)
  assert.equal((await second.json()).error.code, 'ai/busy')
  release()
  await first.text()
})

test('routes: handoff delegates to the service', async t => {
  const handoffFixture = await routerFixture(t)
  const handoff = {
    async perform(request) {
      return { sessionId: 's-1', workspaceId: 'w-1', scope: { kind: request.scope.kind }, files: [], prompt: 'p' }
    },
  }
  const router = createRouter({
    store: handoffFixture.store,
    files: handoffFixture.files,
    ai: fakeAi(),
    handoff,
    config: handoffFixture.config,
    logger: { info() {}, warn() {} },
    runtime: { ready: Promise.resolve(), warnings: [] },
  })
  const response = await routeOf(router, '/handoff').fetch(post('/handoff', { scope: { kind: 'workspace' } }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.sessionId, 's-1')
})
