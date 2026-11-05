/** Client store: load, optimistic mutation, rollback, conflict reload, migration. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbenchStore, initialSnapshot, LEGACY_KEY, MIGRATION_FLAG } from '../src/client/store.js'
import { ApiError } from '../src/client/api.js'

/** Empty server state. */
function emptyState() {
  return {
    schemaVersion: 2,
    revision: 0,
    updatedAt: '2026-11-04T00:00:00.000Z',
    migration: { legacyImportedAt: null, legacySchema: null, v2MigratedAt: null },
    projects: [],
    opportunities: [],
    meetings: [],
    research: [],
    docs: [],
  }
}

/** One state response. */
function stateResponse(state = emptyState()) {
  return {
    state,
    revision: state.revision,
    root: '/data/workbench',
    ai: { available: true, provider: 'deepseek', model: 'deepseek-chat', modelName: 'DeepSeek', reason: null },
    readOnly: false,
    warnings: [],
    rootError: null,
    migration: state.migration,
  }
}

/** A recording fake API. */
function fakeApi(overrides = {}) {
  const calls = { getState: 0, mutate: [], readFile: [], writeFile: [], handoff: [], legacyImport: 0 }
  return {
    calls,
    async getState() {
      calls.getState += 1
      if (overrides.getState !== undefined) return overrides.getState(calls.getState)
      return stateResponse()
    },
    async mutate(revision, mutation, locale) {
      calls.mutate.push({ revision, mutation, locale })
      if (overrides.mutate !== undefined) return overrides.mutate(revision, mutation, locale)
      const state = emptyState()
      state.revision = revision + 1
      state.projects.push({ id: 'p-1', name: 'A', currentStage: 0, deliveredAt: null, stages: [] })
      return { state, revision: state.revision, result: { projectId: 'p-1' } }
    },
    async readFile(path) {
      calls.readFile.push(path)
      return { path, text: '# body\n', hash: 'h1', bytes: 7 }
    },
    async writeFile(path, content, baseHash) {
      calls.writeFile.push({ path, content, baseHash })
      return { path, hash: 'h2', bytes: content.length }
    },
    async handoff(scope, locale) {
      calls.handoff.push({ scope, locale })
      return { sessionId: 's-1', prompt: 'p', workspaceFallback: false }
    },
    async legacyImport(state, revision, locale) {
      calls.legacyImport += 1
      const next = emptyState()
      next.migration = { legacyImportedAt: '2026-11-04T00:00:00.000Z', legacySchema: 2 }
      next.projects.push({ id: 'p-legacy', name: '旧项目', currentStage: 0, deliveredAt: null, stages: [] })
      return { alreadyImported: false, counts: { projects: 1, opportunities: 2, meetings: 1 }, state: next, revision: next.revision }
    },
  }
}

/** A Map-backed storage stub. */
function fakeStorage(values = {}) {
  const map = new Map(Object.entries(values))
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  }
}

test('store: load fills the snapshot and exposes the root and AI status', async () => {
  const api = fakeApi()
  const store = createWorkbenchStore({ api, storage: fakeStorage(), getLang: () => 'en' })
  const data = await store.load()
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.root, '/data/workbench')
  assert.equal(snapshot.ai.available, true)
  assert.equal(snapshot.state.revision, 0)
  assert.equal(data.root, '/data/workbench')
})

test('store: a successful mutation replaces state and revision', async () => {
  const api = fakeApi()
  const store = createWorkbenchStore({ api, storage: fakeStorage() })
  await store.load()
  await store.mutate({ op: 'project.create', name: 'A' })
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.revision, 1)
  assert.equal(snapshot.state.projects.length, 1)
  assert.equal(api.calls.mutate[0].revision, 0)
})

test('store: an optimistic patch is rolled back when the host rejects it', async () => {
  const api = fakeApi({
    getState: () => stateResponse({
      ...emptyState(),
      projects: [{ id: 'p-1', name: 'A', currentStage: 0, deliveredAt: null, stages: [] }],
    }),
    mutate: async () => { throw new ApiError('mutation/unknown', 'no', 400) },
  })
  const store = createWorkbenchStore({ api, storage: fakeStorage() })
  await store.load()
  const before = store.getSnapshot().state
  await assert.rejects(
    () => store.mutate({ op: 'project.delete', projectId: 'p-1' }, {
      optimistic: state => ({ ...state, projects: [] }),
    }),
    error => error.code === 'mutation/unknown',
  )
  assert.deepEqual(store.getSnapshot().state, before)
})

test('store: a 409 reloads the whole state', async () => {
  const conflictState = {
    ...emptyState(),
    revision: 4,
    projects: [{ id: 'p-2', name: 'B', currentStage: 0, deliveredAt: null, stages: [] }],
  }
  const api = fakeApi({
    getState: () => stateResponse(conflictState),
    mutate: async () => {
      throw new ApiError('state/conflict', 'conflict', 409, { revision: 4, state: conflictState })
    },
  })
  const store = createWorkbenchStore({ api, storage: fakeStorage() })
  await store.load()
  await assert.rejects(() => store.mutate({ op: 'project.create', name: 'C' }))
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.revision, 4)
  assert.equal(snapshot.state.projects[0].name, 'B')
  assert.equal(api.calls.getState, 2)
})

test('store: legacy data is imported once and the marker is written', async () => {
  const storage = fakeStorage({ [LEGACY_KEY]: JSON.stringify({ version: 2, projects: [], opportunities: [], meetings: [] }) })
  const api = fakeApi()
  const store = createWorkbenchStore({ api, storage })
  await store.load()
  assert.equal(api.calls.legacyImport, 1)
  assert.equal(store.getSnapshot().state.projects[0].name, '旧项目')
  assert.ok(storage.map.get(MIGRATION_FLAG) !== undefined)
  await store.load()
  assert.equal(api.calls.legacyImport, 1)
})

test('store: a corrupt legacy snapshot is skipped with a notice', async () => {
  const storage = fakeStorage({ [LEGACY_KEY]: '{ not json' })
  const api = fakeApi()
  const store = createWorkbenchStore({ api, storage })
  await store.load()
  assert.equal(api.calls.legacyImport, 0)
  assert.equal(store.getSnapshot().lastLegacy.status, 'invalid')
})

test('store: file reads are cached until forced', async () => {
  const api = fakeApi()
  const store = createWorkbenchStore({ api, storage: fakeStorage() })
  await store.load()
  const first = await store.loadFile('projects/p-1/project.md')
  const second = await store.loadFile('projects/p-1/project.md')
  assert.equal(first.hash, 'h1')
  assert.equal(second.hash, 'h1')
  assert.equal(api.calls.readFile.length, 1)
  await store.loadFile('projects/p-1/project.md', { force: true })
  assert.equal(api.calls.readFile.length, 2)
})

test('store: saving a body updates its hash in the cache', async () => {
  const api = fakeApi()
  const store = createWorkbenchStore({ api, storage: fakeStorage() })
  await store.load()
  await store.loadFile('a.md')
  await store.saveFile('a.md', '# new\n', 'h1')
  const file = store.getSnapshot().files['a.md']
  assert.equal(file.text, '# new\n')
  assert.equal(file.hash, 'h2')
  assert.equal(api.calls.writeFile[0].baseHash, 'h1')
})

test('store: dirty editors are tracked and handoff opens the session', async () => {
  const api = fakeApi()
  let opened = null
  const store = createWorkbenchStore({ api, storage: fakeStorage(), openSession: id => { opened = id } })
  await store.load()
  store.setDirty('a.md', true)
  assert.equal(store.hasDirty(), true)
  store.setDirty('a.md', false)
  assert.equal(store.hasDirty(), false)
  const result = await store.handoff({ kind: 'workspace' })
  assert.equal(result.sessionId, 's-1')
  assert.equal(opened, 's-1')
})

test('store: setView keeps the section valid and prunes deleted records', async () => {
  const api = fakeApi()
  const store = createWorkbenchStore({ api, storage: fakeStorage() })
  await store.load()
  store.setView({ section: 'bogus' })
  assert.equal(store.getSnapshot().view.section, 'projects')
  store.setView({ section: 'projects', projectId: 'missing', stage: 2 })
  await store.refresh()
  assert.equal(store.getSnapshot().view.projectId, undefined)
})

test('store: initial snapshot is a loading shell', () => {
  const snapshot = initialSnapshot()
  assert.equal(snapshot.status, 'loading')
  assert.deepEqual(snapshot.view, { section: 'overview' })
  assert.deepEqual(snapshot.dirtyPaths, [])
})
