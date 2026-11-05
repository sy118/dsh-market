/** AI route discovery, prompt building, parsing, and the streaming service. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeAi } from '../src/host/ai/capabilities.js'
import { buildPrompt } from '../src/host/ai/prompts.js'
import { buildCappedContext } from '../src/host/ai/context.js'
import { extractJson, normalizeMarkdown, parseTaskResult, validateAssessment, validateAssistantCommand, validateExtraction } from '../src/host/ai/parse.js'
import { createAiService } from '../src/host/ai/service.js'
import { applyMutation } from '../src/host/state.js'
import { scoreOpportunity } from '../src/shared/scoring.js'
import { resolveConfig } from '../src/host/config.js'
import { hostFixture } from './helpers.mjs'

/** A fake DSH model stack. */
function fakeContext(options = {}) {
  const provider = options.provider ?? 'deepseek'
  const model = options.model ?? 'deepseek-chat'
  const calls = []
  const chunks = options.chunks ?? [
    { type: 'text-delta', index: 0, text: 'hello ' },
    { type: 'text-delta', index: 0, text: 'world' },
    { type: 'finish', reason: 'stop' },
  ]
  const llm = {
    listProviders: () => [{ id: provider, name: 'DeepSeek' }],
    listModels: () => [{ provider, id: model, name: 'DeepSeek Chat' }],
    resolveModelInfo: async () => {
      if (options.unavailable === true) throw Object.assign(new Error('missing credential'), { code: 'MISSING_CREDENTIAL' })
      return { provider, id: model, name: 'DeepSeek Chat' }
    },
    stream: options.stream ?? (async function* stream(request) {
      calls.push(request)
      for (const chunk of chunks) yield chunk
    }),
  }
  const services = {
    llm,
    agentDefaultModel: { currentSelection: () => (options.noDefault === true ? undefined : { provider, model }) },
  }
  return {
    llm,
    calls,
    get(key) {
      return services[key]
    },
  }
}

/** Seed one project, stage, opportunity, and meeting. */
async function seededFixture(t) {
  const fixture = await hostFixture(t)
  const { store, files } = fixture
  await store.mutate(0, state => applyMutation(state, { op: 'project.create', name: '应付账款对账' }, { files, locale: 'zh' }))
  let state = (await store.read()).state
  const projectId = state.projects[0].id
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'stage.note.set',
    projectId,
    stage: 0,
    text: '访谈记录：发票需要三单匹配。',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'meeting.create',
    title: '月结访谈',
    date: '2026-10-01',
    attendees: ['张三'],
    content: '报销单据越来越多，能不能自动识别发票、核对预算，再让人复核？',
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  const meetingId = state.meetings[0].id
  await store.mutate(state.revision, current => applyMutation(current, {
    op: 'opportunity.create',
    title: '发票三单匹配',
    description: '现状：人工核对三单。目标：自动匹配并提示差异。',
    domain: 'ap',
    taskType: 'validate',
    source: { type: 'meeting', meetingId },
    ratings: { data: 4, rules: 4, review: 4, value: 4, adoption: 3 },
  }, { files, locale: 'zh' }))
  state = (await store.read()).state
  return { ...fixture, projectId, meetingId, opportunityId: state.opportunities[0].id }
}

test('capabilities: uses the default route and reports the model', async () => {
  const ctx = fakeContext()
  const status = await describeAi({ ctx, config: resolveConfig() })
  assert.equal(status.available, true)
  assert.equal(status.provider, 'deepseek')
  assert.equal(status.model, 'deepseek-chat')
  assert.equal(status.source, 'default')
})

test('capabilities: no llm, no route, missing provider, missing credential', async () => {
  const empty = { get: () => undefined }
  assert.equal((await describeAi({ ctx: empty, config: resolveConfig() })).reason, 'ai/no-llm')

  const noDefault = fakeContext({ noDefault: true })
  assert.equal((await describeAi({ ctx: noDefault, config: resolveConfig() })).reason, 'ai/no-route')

  const missingProvider = fakeContext({ provider: 'other' })
  const config = resolveConfig({ ai: { provider: 'deepseek', model: 'deepseek-chat' } })
  assert.equal((await describeAi({ ctx: missingProvider, config })).reason, 'ai/provider-missing')

  const unavailable = fakeContext({ unavailable: true })
  assert.equal((await describeAi({ ctx: unavailable, config })).reason, 'ai/unavailable')
})

test('prompts: structured tasks demand JSON and the locale controls the language', () => {
  const zh = buildPrompt('opportunity.assess', { contextText: '{"a":1}', locale: 'zh' })
  assert.ok(zh.system.includes('JSON'))
  assert.ok(zh.system.includes('简体中文'))
  assert.ok(zh.user.includes('<records>'))
  const en = buildPrompt('assistant.chat', { contextText: 'x', locale: 'en', userText: 'What is missing?' })
  assert.ok(en.system.includes('English'))
  assert.ok(en.user.includes('<question>'))
})

test('parse: extracts JSON from fences and prose', () => {
  const fenced = extractJson('Here you go:\n```json\n{"a":1}\n```\nThanks')
  assert.deepEqual(fenced, { a: 1 })
  const prose = extractJson('prefix {"b": [2]} suffix')
  assert.deepEqual(prose, { b: [2] })
  assert.equal(extractJson('no json here'), null)
})

test('parse: assessment accepts valid values and reports out-of-range fields', () => {
  const good = validateAssessment({
    ratings: { data: 4, rules: 4, review: 4, value: 4, adoption: 3 },
    compliance: 'medium',
    verdict: 'pilot',
    rationale: 'ok',
    conditions: ['补数据'],
  })
  assert.equal(good.complete, true)
  assert.equal(good.value.ratings.data, 4)

  const bad = validateAssessment({
    ratings: { data: 9, rules: 0, review: 3, value: 3, adoption: 3 },
    compliance: 'high',
    verdict: 'pilot',
  })
  assert.ok(bad.invalid.includes('ratings.data'))
  assert.ok(bad.invalid.includes('ratings.rules'))
  assert.equal(bad.value.ratings.data, 5)
  assert.equal(bad.value.ratings.rules, 1)
})

test('parse: extraction dedupes, caps, and tolerates empty results', () => {
  const result = validateExtraction({ candidates: [
    { title: 'a', quote: 'q', domain: 'ap', taskType: 'validate', confidence: 0.8 },
    { title: 'a', quote: 'q', domain: 'ap', taskType: 'validate', confidence: 0.8 },
    { title: 'b', quote: 'q2', domain: 'nope', taskType: 'nope' },
    'garbage',
  ] })
  assert.equal(result.value.candidates.length, 2)
  assert.equal(result.value.candidates[1].domain, 'other')
  assert.ok(result.invalid.some(item => item.startsWith('candidates.dropped')))

  const empty = validateExtraction({ candidates: [] })
  assert.deepEqual(empty.value.candidates, [])
})

test('prompts: the assistant command asks for a project confirmation payload', () => {
  const prompt = buildPrompt('assistant.command', { contextText: '{}', locale: 'zh', userText: '帮我创建一个对账项目' })
  assert.ok(prompt.system.includes('project.create'))
  assert.ok(prompt.system.includes('confirmation card'))
  assert.ok(prompt.system.includes('Output only the JSON object'))
})

test('assistant command: only a named, valid project becomes an action', () => {
  const valid = validateAssistantCommand({
    reply: '可以创建。',
    action: 'project.create',
    project: {
      name: '应付账款对账',
      customer: 'ACME',
      owner: '张三',
      startDate: '2026-11-01',
      endDate: '2026-12-31',
      successCriteria: '缩短对账时间',
      stakeholders: '张三、李四',
    },
  })
  assert.equal(valid.value.action, 'project.create')
  assert.equal(valid.value.project.name, '应付账款对账')
  assert.deepEqual(valid.invalid, [])

  const none = validateAssistantCommand({ reply: '当前有三个项目。', action: 'none' })
  assert.equal(none.value.action, 'none')
  assert.equal(none.value.project, null)

  const unnamed = validateAssistantCommand({ reply: '请告诉我项目名。', action: 'project.create', project: { name: '  ' } })
  assert.equal(unnamed.value.action, 'none')
  assert.ok(unnamed.invalid.includes('project.name'))

  const dates = validateAssistantCommand({
    action: 'project.create',
    project: { name: 'X', startDate: '2026-12-01', endDate: '2026-11-01' },
  })
  assert.ok(dates.invalid.includes('project.dateOrder'))
  assert.equal(dates.value.project.startDate, '')

  const parsed = parseTaskResult('assistant.command', JSON.stringify({
    reply: '好的。',
    action: 'project.create',
    project: { name: '项目 A' },
  }), true)
  assert.equal(parsed.result.action, 'project.create')
  assert.equal(parsed.result.project.name, '项目 A')
})

test('parse: task results keep markdown and flag unstructured JSON', () => {
  const markdown = parseTaskResult('doc.draft', '```markdown\n# Title\n\nbody\n```', false)
  assert.equal(markdown.result.markdown, '# Title\n\nbody')
  const bad = parseTaskResult('opportunity.assess', 'I cannot answer', true)
  assert.equal(bad.error, 'ai/unstructured')
  assert.equal(parseTaskResult('assistant.chat', '   ', false).error, 'ai/empty')
  assert.equal(normalizeMarkdown('  # x  '), '# x')
})

test('context: renders selected records and their file paths', async t => {
  const fixture = await seededFixture(t)
  const state = (await fixture.store.read()).state
  const context = await buildCappedContext('opportunity.assess', { opportunityId: fixture.opportunityId }, {
    state,
    files: fixture.files,
    locale: 'zh',
    limit: 200 * 1024,
  })
  assert.ok(context.contextText.includes('发票三单匹配'))
  assert.ok(context.contextText.includes('月结访谈'))
  assert.ok(context.files.includes(`opportunities/${fixture.opportunityId}.md`))
  assert.ok(context.files.some(path => path.startsWith('meetings/')))
})

test('context: trimming stays within the byte limit and marks the cut', async t => {
  const fixture = await seededFixture(t)
  const state = (await fixture.store.read()).state
  const context = await buildCappedContext('meeting.extract', { meetingId: fixture.meetingId }, {
    state,
    files: fixture.files,
    locale: 'zh',
    limit: 200,
  })
  assert.ok(Buffer.byteLength(context.contextText, 'utf8') <= 200)
  assert.ok(context.truncated)
  assert.ok(context.contextText.includes('[context truncated'))
})

test('service: streams deltas and returns the parsed proposal', async t => {
  const fixture = await seededFixture(t)
  const ctx = fakeContext({
    chunks: [
      { type: 'text-delta', index: 0, text: '{"ratings":{"data":4,"rules":4,"review":4,"value":4,"adoption":3},' },
      { type: 'text-delta', index: 0, text: '"compliance":"medium","verdict":"pilot","rationale":"ok","conditions":[]}' },
      { type: 'finish', reason: 'stop' },
    ],
  })
  const config = resolveConfig({ root: fixture.root })
  const ai = createAiService({ ctx, config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  const deltas = []
  const result = await ai.run({
    task: 'opportunity.assess',
    payload: { opportunityId: fixture.opportunityId },
    locale: 'zh',
    onDelta: text => deltas.push(text),
  })
  assert.equal(deltas.join(''), result.text)
  assert.equal(result.result.ratings.data, 4)
  assert.equal(result.result.verdict, 'pilot')
  assert.equal(result.route.model, 'deepseek-chat')
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].maxTokens, config.ai.maxTokens)
})

test('service: unavailable AI is a 503 with a reason', async t => {
  const fixture = await seededFixture(t)
  const config = resolveConfig({ root: fixture.root })
  const ai = createAiService({
    ctx: fakeContext({ unavailable: true }),
    config,
    store: fixture.store,
    files: fixture.files,
    logger: { info() {}, warn() {} },
  })
  await assert.rejects(
    () => ai.run({ task: 'meeting.extract', payload: { meetingId: fixture.meetingId }, locale: 'zh' }),
    error => error.code === 'ai/unavailable' && error.status === 503,
  )
})

test('service: timeouts abort the provider and surface ai/timeout', async t => {
  const fixture = await seededFixture(t)
  const config = resolveConfig({ root: fixture.root })
  config.ai.timeoutMs = 20
  const ctx = fakeContext({
    stream: async function* stream(request) {
      await new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (request.signal.aborted) abort()
        else request.signal.addEventListener('abort', abort, { once: true })
      })
      yield { type: 'finish', reason: 'stop' }
    },
  })
  const ai = createAiService({ ctx, config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  await assert.rejects(
    () => ai.run({ task: 'meeting.extract', payload: { meetingId: fixture.meetingId }, locale: 'zh' }),
    error => error.code === 'ai/timeout' && error.status === 408,
  )
})

test('service: assistant.command returns a validated project proposal', async t => {
  const fixture = await hostFixture(t)
  const config = resolveConfig({ root: fixture.root })
  const answer = JSON.stringify({
    reply: '可以创建这个项目。',
    action: 'project.create',
    project: { name: '应付账款对账', customer: 'ACME', owner: '张三' },
  })
  const ai = createAiService({
    ctx: fakeContext({ chunks: [{ type: 'text-delta', text: answer }, { type: 'finish', reason: 'stop' }] }),
    config,
    store: fixture.store,
    files: fixture.files,
    logger: { info() {}, warn() {} },
  })
  const result = await ai.run({
    task: 'assistant.command',
    payload: { scope: { kind: 'workspace' }, messages: [{ role: 'user', text: '帮我创建项目' }] },
    locale: 'zh',
  })
  assert.equal(result.result.action, 'project.create')
  assert.equal(result.result.project.name, '应付账款对账')
  assert.equal(result.result.reply, '可以创建这个项目。')
})

test('service: empty or errored streams are surfaced, not parsed', async t => {
  const fixture = await seededFixture(t)
  const config = resolveConfig({ root: fixture.root })

  const empty = createAiService({
    ctx: fakeContext({ chunks: [{ type: 'finish', reason: { kind: 'stop' } }] }),
    config,
    store: fixture.store,
    files: fixture.files,
    logger: { info() {}, warn() {} },
  })
  await assert.rejects(
    () => empty.run({ task: 'meeting.extract', payload: { meetingId: fixture.meetingId }, locale: 'zh' }),
    error => error.code === 'ai/empty' && error.status === 422,
  )

  const failed = createAiService({
    ctx: fakeContext({ chunks: [{ type: 'finish', reason: { kind: 'error', failure: { code: 'PROVIDER_ERROR' } } }] }),
    config,
    store: fixture.store,
    files: fixture.files,
    logger: { info() {}, warn() {} },
  })
  await assert.rejects(
    () => failed.run({ task: 'meeting.extract', payload: { meetingId: fixture.meetingId }, locale: 'zh' }),
    error => error.code === 'ai/failed' && error.details.cause === 'PROVIDER_ERROR',
  )

  const truncated = createAiService({
    ctx: fakeContext({ chunks: [{ type: 'finish', reason: { kind: 'max-tokens' } }] }),
    config,
    store: fixture.store,
    files: fixture.files,
    logger: { info() {}, warn() {} },
  })
  await assert.rejects(
    () => truncated.run({ task: 'opportunity.assess', payload: { opportunityId: fixture.opportunityId }, locale: 'zh' }),
    error => error.code === 'ai/truncated' && error.status === 422,
  )
})

test('service: a missing credential disables the route for later status reads', async t => {
  const fixture = await seededFixture(t)
  const config = resolveConfig({ root: fixture.root })
  const ctx = fakeContext({
    chunks: [{ type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } } }],
  })
  const ai = createAiService({ ctx, config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  await assert.rejects(
    () => ai.run({ task: 'meeting.extract', payload: { meetingId: fixture.meetingId }, locale: 'zh' }),
    error => error.code === 'ai/unavailable' && error.status === 503 && error.details.cause === 'MISSING_CREDENTIAL',
  )
  const status = await ai.status()
  assert.equal(status.available, false)
  assert.equal(status.reason, 'ai/missing-credential')
})

test('service: caller cancellation maps to ai/cancelled', async t => {
  const fixture = await seededFixture(t)
  const config = resolveConfig({ root: fixture.root })
  const controller = new AbortController()
  const ctx = fakeContext({
    stream: async function* stream(request) {
      await new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        request.signal.addEventListener('abort', abort, { once: true })
      })
      yield { type: 'finish', reason: 'stop' }
    },
  })
  const ai = createAiService({ ctx, config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  const running = ai.run({
    task: 'meeting.extract',
    payload: { meetingId: fixture.meetingId },
    locale: 'zh',
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(running, error => error.code === 'ai/cancelled')
})

test('service: a proposal does not write until a human applies it', async t => {
  const fixture = await seededFixture(t)
  const ctx = fakeContext({
    chunks: [
      {
        type: 'text-delta',
        index: 0,
        text: '{"ratings":{"data":4,"rules":4,"review":4,"value":4,"adoption":3},"compliance":"medium","verdict":"pilot","rationale":"ok","conditions":["补数据"]}',
      },
      { type: 'finish', reason: 'stop' },
    ],
  })
  const config = resolveConfig({ root: fixture.root })
  const ai = createAiService({ ctx, config, store: fixture.store, files: fixture.files, logger: { info() {}, warn() {} } })
  const before = (await fixture.store.read()).state
  const result = await ai.run({
    task: 'opportunity.assess',
    payload: { opportunityId: fixture.opportunityId },
    locale: 'zh',
  })
  const unchanged = (await fixture.store.read()).state
  assert.equal(unchanged.revision, before.revision)
  assert.deepEqual(unchanged.opportunities[0].ratings, before.opportunities[0].ratings)

  // Applying the proposal is an explicit mutation, and the score is recomputed
  // from the fixed weights rather than trusted from the model.
  await fixture.store.mutate(unchanged.revision, state => applyMutation(state, {
    op: 'opportunity.update',
    opportunityId: fixture.opportunityId,
    ratings: result.result.ratings,
    compliance: result.result.compliance,
  }, { files: fixture.files, locale: 'zh' }))
  const applied = (await fixture.store.read()).state.opportunities[0]
  const derived = scoreOpportunity(applied.ratings, applied.compliance)
  assert.equal(derived.score, 78)
  assert.equal(derived.verdict, 'pilot')
})
