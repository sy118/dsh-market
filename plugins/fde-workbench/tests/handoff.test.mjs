/** Handoff scopes, prompts, AGENTS.md, and the session/workspace orchestration. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandoff } from '../src/host/handoff.js'
import { resolveScope, renderHandoffPrompt } from '../src/host/handoff-prompt.js'
import { ensureAgentsMd, renderAgentsMd } from '../src/host/agents-md.js'
import { applyMutation } from '../src/host/state.js'
import { hostFixture } from './helpers.mjs'

/** Seed one record of every scope. */
async function seeded(t) {
  const fixture = await hostFixture(t)
  const { store, files } = fixture
  await store.mutate(0, state => applyMutation(state, { op: 'project.create', name: '应付账款对账' }, { files, locale: 'zh' }))
  let state = (await store.read()).state
  const projectId = state.projects[0].id
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'stage.note.set',
    projectId,
    stage: 0,
    text: '阶段备注',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'meeting.create',
    title: '月结访谈',
    date: '2026-10-01',
    content: '原始纪要',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  const meetingId = state.meetings[0].id
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'opportunity.create',
    title: '发票三单匹配',
    source: { type: 'meeting', meetingId },
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  const opportunityId = state.opportunities[0].id
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'research.create',
    title: '三单匹配调研',
    projectId,
    stage: 1,
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  const researchId = state.research[0].id
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'doc.create',
    title: '交付说明',
    projectId,
    template: 'delivery',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  const docId = state.docs[0].id
  return { ...fixture, state, projectId, meetingId, opportunityId, researchId, docId }
}

/** A session controller + workspace registry that record their calls. */
function fakeServices(options = {}) {
  const calls = { created: [], prompted: [] }
  const controller = {
    async create(request) {
      calls.created.push(request)
      if (options.createError === true) throw new Error('create failed')
      return { sessionId: 'session-1' }
    },
    async prompt(request, signal) {
      calls.prompted.push({ request, signal })
      if (options.promptError === true) throw new Error('prompt failed')
    },
  }
  const registry = {
    async create(path, title) {
      if (options.workspaceError === true) throw new Error('workspace failed')
      calls.workspace = { path, title }
      return { id: 'workspace-1' }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'sessionController') return options.noController === true ? undefined : controller
      if (name === 'workspaceRegistry') return options.noRegistry === true ? undefined : registry
      return undefined
    },
  }
  return { ctx, controller, registry, calls }
}

test('agents-md: renders the schema, enums, and rules; rewrite is idempotent', async t => {
  const { files } = await hostFixture(t)
  const text = renderAgentsMd()
  assert.ok(text.includes('<!-- fde-workbench: schema 2 -->'))
  assert.ok(text.includes('projects/<projectId>/stages/<0-7>.md'))
  assert.ok(text.includes('extract | validate | summarize'))
  assert.ok(text.includes('阶段决定必须由人确认'))
  const first = await ensureAgentsMd({ files, logger: { info() {} } })
  assert.equal(first.written, true)
  const second = await ensureAgentsMd({ files, logger: { info() {} } })
  assert.equal(second.written, false)
})

test('scope: resolves every scope kind to title, description, and files', async t => {
  const fixture = await seeded(t)
  const project = resolveScope({ kind: 'project', id: fixture.projectId }, fixture.state, 'zh')
  assert.ok(project.description.includes('应付账款对账'))
  assert.ok(project.files.includes(`projects/${fixture.projectId}/project.md`))

  const stage = resolveScope({ kind: 'stage', id: fixture.projectId, stage: 0 }, fixture.state, 'zh')
  assert.ok(stage.title.includes('发现高价值问题'))
  assert.ok(stage.files.some(path => path.endsWith('stages/0.md')))

  const opportunity = resolveScope({ kind: 'opportunity', id: fixture.opportunityId }, fixture.state, 'zh')
  assert.ok(opportunity.files.some(path => path.startsWith('opportunities/')))
  assert.ok(opportunity.files.some(path => path.startsWith('meetings/')))

  const meeting = resolveScope({ kind: 'meeting', id: fixture.meetingId }, fixture.state, 'zh')
  assert.ok(meeting.files.includes(`meetings/${fixture.meetingId}.md`))

  const research = resolveScope({ kind: 'research', id: fixture.researchId }, fixture.state, 'zh')
  assert.ok(research.files.some(path => path.startsWith('projects/')))
  const doc = resolveScope({ kind: 'doc', id: fixture.docId }, fixture.state, 'zh')
  assert.ok(doc.files.some(path => path.startsWith('projects/')))

  const workspace = resolveScope({ kind: 'workspace' }, fixture.state, 'zh')
  assert.ok(workspace.files.includes('AGENTS.md'))
  assert.ok(workspace.description.includes('项目'))

  assert.throws(() => resolveScope({ kind: 'project', id: 'missing' }, fixture.state, 'zh'), error => error.status === 404)
})

test('prompt: names the root, files, and human-only rules in both languages', async t => {
  const fixture = await seeded(t)
  const scope = resolveScope({ kind: 'stage', id: fixture.projectId, stage: 0 }, fixture.state, 'zh')
  const zh = renderHandoffPrompt({ root: fixture.root, scope, locale: 'zh' })
  assert.ok(zh.includes(fixture.root))
  assert.ok(zh.includes('AGENTS.md'))
  assert.ok(zh.includes('不要改 currentStage'))
  const en = renderHandoffPrompt({ root: fixture.root, scope, locale: 'en' })
  assert.ok(en.includes('Never change currentStage'))
})

test('handoff: creates a workspace and session, then prompts it', async t => {
  const fixture = await seeded(t)
  const services = fakeServices()
  const handoff = createHandoff({ ctx: services.ctx, config: fixture.config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  const result = await handoff.perform({ scope: { kind: 'project', id: fixture.projectId }, locale: 'zh' })
  assert.equal(result.sessionId, 'session-1')
  assert.equal(result.workspaceId, 'workspace-1')
  assert.equal(services.calls.created[0].workspaceId, 'workspace-1')
  assert.equal(services.calls.prompted.length, 1)
  assert.ok(services.calls.prompted[0].request.content[0].text.includes('AGENTS.md'))
  assert.equal(services.calls.prompted[0].request.mode, 'queue')
  assert.match(services.calls.prompted[0].request.requestId, /^fde-/)
})

test('handoff: a workspace failure falls back to cwd', async t => {
  const fixture = await seeded(t)
  const services = fakeServices({ workspaceError: true })
  const handoff = createHandoff({ ctx: services.ctx, config: fixture.config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  const result = await handoff.perform({ scope: { kind: 'meeting', id: fixture.meetingId }, locale: 'zh' })
  assert.equal(result.sessionId, 'session-1')
  assert.equal(result.workspaceFallback, true)
  assert.equal(services.calls.created[0].cwd, fixture.root)
})

test('handoff: missing session control is a 503', async t => {
  const fixture = await seeded(t)
  const services = fakeServices({ noController: true })
  const handoff = createHandoff({ ctx: services.ctx, config: fixture.config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  await assert.rejects(
    () => handoff.perform({ scope: { kind: 'workspace' }, locale: 'zh' }),
    error => error.code === 'handoff/unavailable' && error.status === 503,
  )
})

test('handoff: creation and prompt failures carry stable codes', async t => {
  const fixture = await seeded(t)
  const createFailure = fakeServices({ createError: true })
  const first = createHandoff({ ctx: createFailure.ctx, config: fixture.config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  await assert.rejects(
    () => first.perform({ scope: { kind: 'workspace' }, locale: 'zh' }),
    error => error.code === 'handoff/create-failed' && error.status === 502,
  )

  const promptFailure = fakeServices({ promptError: true })
  const second = createHandoff({ ctx: promptFailure.ctx, config: fixture.config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  await assert.rejects(
    () => second.perform({ scope: { kind: 'workspace' }, locale: 'zh' }),
    error => error.code === 'handoff/prompt-failed' && error.details.sessionId === 'session-1',
  )
})

test('handoff: the first message respects the size cap', async t => {
  const fixture = await seeded(t)
  const config = { ...fixture.config, limits: { ...fixture.config.limits, handoffBytes: 512 } }
  const services = fakeServices()
  const handoff = createHandoff({ ctx: services.ctx, config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  const result = await handoff.perform({ scope: { kind: 'project', id: fixture.projectId }, locale: 'zh' })
  assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= 512)
  assert.ok(result.prompt.includes('[context truncated'))
})
