/** Pure client selectors and the browser API envelope/stream parser. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterDocs,
  filterOpportunities,
  filterProjects,
  filterResearch,
  ganttRange,
  ganttRow,
  handoffScope,
  nextActions,
  openBlockers,
  opportunitiesOfMeeting,
  overviewStats,
  projectEvidence,
  projectNextAction,
  pruneView,
  stageState,
  taskCenter,
  workProgress,
} from '../src/client/selectors.js'
import { ApiError, getState, parseEventBlock, readEventStream } from '../src/client/api.js'

/** Build one project with the given stage and blockers. */
function project(id, currentStage, delivered = false, blockers = []) {
  return {
    id,
    name: `Project ${id}`,
    customer: '',
    owner: '',
    targetDate: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    currentStage,
    deliveredAt: delivered ? '2026-10-02T00:00:00.000Z' : null,
    file: `projects/${id}/project.md`,
    stages: Array.from({ length: 8 }, (_, index) => ({
      work: [{ id: `w-${index}`, text: 'x', done: index < currentStage }],
      artifacts: [],
      blockers: index === currentStage ? blockers : [],
      decisions: [],
      noteFile: '',
    })),
  }
}

/** One opportunity. */
function opportunity(id, ratings, extra = {}) {
  return {
    id,
    title: `Opportunity ${id}`,
    description: 'desc',
    proposer: 'p',
    domain: 'ap',
    taskType: 'validate',
    source: { type: 'idea', meetingId: '' },
    ratings,
    compliance: 'medium',
    status: 'candidate',
    file: `opportunities/${id}.md`,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }
}

/** One full state. */
function state(overrides = {}) {
  return {
    schemaVersion: 2,
    revision: 0,
    updatedAt: '',
    migration: { legacyImportedAt: null, legacySchema: null, v2MigratedAt: null },
    projects: [],
    opportunities: [],
    meetings: [],
    research: [],
    docs: [],
    ...overrides,
  }
}

test('selectors: overview counts and stage distribution skip delivered projects', () => {
  const stats = overviewStats(state({
    projects: [
      project('a', 2, false, [{ id: 'b1', resolved: false }, { id: 'b2', resolved: true }]),
      project('b', 0, true),
      project('c', 6),
    ],
  }))
  assert.equal(stats.projects, 3)
  assert.equal(stats.active, 2)
  assert.equal(stats.delivered, 1)
  assert.equal(stats.blockers, 1)
  assert.equal(stats.byStage[2], 1)
  assert.equal(stats.byStage[6], 1)
  assert.equal(stats.byStage[0], 0)
})

test('selectors: stage state covers done, current, todo, and delivered', () => {
  const running = project('a', 3)
  assert.equal(stageState(running, 0), 'done')
  assert.equal(stageState(running, 3), 'current')
  assert.equal(stageState(running, 7), 'todo')
  const delivered = project('b', 7, true)
  assert.equal(stageState(delivered, 0), 'done')
  assert.equal(stageState(delivered, 7), 'done')
  assert.deepEqual(workProgress(running.stages[3]), { done: 0, total: 1 })
  assert.equal(openBlockers(running), 0)
})

test('selectors: next actions prioritise blockers and stage decisions', () => {
  const actions = nextActions(state({
    projects: [
      project('a', 1, false, [{ id: 'b1', resolved: false }]),
      project('b', 7),
    ],
    opportunities: [opportunity('o1', { data: 3, rules: 3, review: 3, value: 3, adoption: 3 })],
    research: [{ id: 'r1', status: 'open' }],
  }), 10)
  assert.equal(actions[0].code, 'blocked')
  assert.ok(actions.some(action => action.code === 'deliver'))
  assert.ok(actions.some(action => action.code === 'opportunity'))
  assert.ok(actions.some(action => action.code === 'research'))
})

test('selectors: opportunities sort by derived score and filter by query', () => {
  const items = filterOpportunities(state({
    opportunities: [
      opportunity('low', { data: 2, rules: 2, review: 2, value: 2, adoption: 2 }),
      opportunity('high', { data: 5, rules: 5, review: 5, value: 5, adoption: 5 }),
    ],
  }))
  assert.deepEqual(items.map(item => item.id), ['high', 'low'])
  const searched = filterOpportunities(state({
    opportunities: [
      opportunity('a', { data: 3, rules: 3, review: 3, value: 3, adoption: 3 }, { title: '发票匹配' }),
      opportunity('b', { data: 3, rules: 3, review: 3, value: 3, adoption: 3 }, { title: '月结' }),
    ],
  }), { query: '发票' })
  assert.deepEqual(searched.map(item => item.id), ['a'])
  assert.equal(searched[0].derived.score, 60)
})

test('selectors: research and docs filter by project/status', () => {
  const research = filterResearch(state({
    research: [
      { id: 'r1', title: 'a', projectId: 'p1', stage: 0, status: 'open', updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'r2', title: 'b', projectId: 'p2', stage: 0, status: 'closed', updatedAt: '2026-10-02T00:00:00.000Z' },
    ],
  }), { projectId: 'p1' })
  assert.deepEqual(research.map(item => item.id), ['r1'])
  const docs = filterDocs(state({
    docs: [
      { id: 'd1', title: 'a', projectId: 'p1', status: 'approved', updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'd2', title: 'b', projectId: 'p1', status: 'draft', updatedAt: '2026-10-02T00:00:00.000Z' },
    ],
  }), { status: 'draft' })
  assert.deepEqual(docs.map(item => item.id), ['d2'])
})

test('selectors: meeting links and scope resolution', () => {
  const linked = opportunitiesOfMeeting(state({
    opportunities: [opportunity('o1', { data: 3, rules: 3, review: 3, value: 3, adoption: 3 }, { source: { type: 'meeting', meetingId: 'm1' } })],
  }), 'm1')
  assert.equal(linked.length, 1)
  assert.equal(linked[0].derived.score, 60)

  assert.deepEqual(handoffScope({ section: 'projects', projectId: 'p1', stage: 2 }), { kind: 'stage', id: 'p1', stage: 2 })
  assert.deepEqual(handoffScope({ section: 'projects', projectId: 'p1' }), { kind: 'project', id: 'p1' })
  assert.deepEqual(handoffScope({ section: 'opportunities', opportunityId: 'o1' }), { kind: 'opportunity', id: 'o1' })
  assert.deepEqual(handoffScope({ section: 'overview' }), { kind: 'workspace' })
})

test('selectors: pruneView removes selections that no longer exist', () => {
  const pruned = pruneView({ section: 'projects', projectId: 'gone', stage: 1, opportunityId: 'gone' }, state())
  assert.equal(pruned.projectId, undefined)
  assert.equal(pruned.opportunityId, undefined)
  assert.equal(pruned.section, 'projects')
})

test('selectors: portfolio filters, next action, task center, and gantt rows', () => {
  const alpha = project('alpha', 1)
  alpha.customer = 'ACME'
  alpha.status = 'active'
  alpha.tasks = [{
    id: 't1', title: '接口确认', status: 'in_progress', priority: 'high', owner: '张三',
    startDate: '2026-10-01', dueDate: '2026-10-10', progress: 30, dependencyIds: [], blockedReason: '',
  }]
  const beta = project('beta', 2)
  beta.status = 'paused'
  const filtered = filterProjects([alpha, beta], { query: 'ACME', status: 'active' })
  assert.deepEqual(filtered.map(item => item.id), ['alpha'])
  assert.equal(projectNextAction(alpha).code, 'work')
  assert.equal(projectNextAction(beta).code, 'resume')
  const center = taskCenter({ projects: [alpha, beta] })
  assert.equal(center.length, 1)
  assert.equal(center[0].projectName, 'Project alpha')
  const range = ganttRange(alpha)
  const row = ganttRow(alpha.tasks[0], range)
  assert.ok(row.width > 0)
  assert.equal(ganttRow({ ...alpha.tasks[0], dueDate: '' }, range), null)
  assert.equal(projectEvidence(alpha).length, 0)
})

test('api: parses SSE blocks and dispatches events', async () => {  assert.deepEqual(parseEventBlock('data: {"type":"delta","text":"a"}'), { type: 'delta', text: 'a' })
  assert.equal(parseEventBlock('event: ping'), null)
  assert.equal(parseEventBlock('data: not json'), null)

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode('data: {"type":"start"}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"delta","text":"a"}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
      controller.close()
    },
  })
  const events = []
  await readEventStream(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }), event => events.push(event))
  assert.deepEqual(events.map(event => event.type), ['start', 'delta', 'done'])
})

test('api: JSON success and error envelopes become data or ApiError', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    assert.deepEqual(await getState(), { ok: true })

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'state/conflict', message: 'x', details: { revision: 2 } } }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })
    await assert.rejects(
      () => getState(),
      error => error instanceof ApiError && error.code === 'state/conflict' && error.status === 409 && error.details.revision === 2,
    )
  } finally {
    globalThis.fetch = original
  }
})
