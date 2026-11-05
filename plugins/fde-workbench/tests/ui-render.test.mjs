/** Server-rendered UI checks: the panel tree renders without a browser. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { WorkbenchApp } from '../src/client/ui/app.js'
import { zh } from '../src/client/i18n/zh.js'
import { en } from '../src/client/i18n/en.js'

/** Interpolating translator over one dictionary. */
function translator(dict) {
  return (key, params) => {
    const text = dict[key]
    if (text === undefined) throw new Error(`missing translation: ${key}`)
    return typeof params === 'object' && params !== null
      ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
      : text
  }
}

/** One project with one populated stage. */
function project(state = 1) {
  return {
    id: 'p-1',
    name: '应付账款对账',
    customer: 'ACME',
    owner: '张三',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    targetDate: '2026-12-31',
    status: 'active',
    successCriteria: '对账时间缩短一半',
    stakeholders: '张三（负责人）、李四（财务）',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    currentStage: state,
    deliveredAt: null,
    reconfirmThrough: null,
    returns: [],
    tasks: [{
      id: 't-1', title: '确认接口清单', status: 'in_progress', priority: 'high', owner: '张三',
      startDate: '2026-10-01', dueDate: '2026-10-10', progress: 40, dependencyIds: [], blockedReason: '',
      stage: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    }],
    sources: [{
      id: 'f-1', name: '访谈.md', mime: 'text/markdown', bytes: 1024, sha256: 'abc', version: 1,
      path: 'projects/p-1/sources/f-1/1/访谈.md', createdAt: '2026-10-01T00:00:00.000Z', replacedAt: null,
    }],
    file: 'projects/p-1/project.md',
    stages: Array.from({ length: 8 }, (_, index) => ({
      id: `stage-${index}`,
      work: [
        { id: `w-${index}-0`, text: `工作项 ${index}.0`, done: index < state },
        { id: `w-${index}-1`, text: `工作项 ${index}.1`, done: index < state },
        { id: `w-${index}-2`, text: `工作项 ${index}.2`, done: index < state },
        { id: `w-${index}-3`, text: `工作项 ${index}.3`, done: index < state },
      ],
      deliverables: [
        { id: `d-${index}-0`, title: `产物 ${index}.0`, path: `fde-deliverables/0${index + 1}/a.md`, required: true, status: index < state ? 'present' : 'missing', bytes: 10, hash: 'h', updatedAt: null, error: null },
        { id: `d-${index}-1`, title: `产物 ${index}.1`, path: `fde-deliverables/0${index + 1}/b.md`, required: true, status: index < state ? 'present' : 'missing', bytes: 10, hash: 'h', updatedAt: null, error: null },
        { id: `d-${index}-2`, title: `产物 ${index}.2`, path: `fde-deliverables/0${index + 1}/c.md`, required: true, status: index < state ? 'present' : 'missing', bytes: 10, hash: 'h', updatedAt: null, error: null },
      ],
      artifacts: index === state ? [{ id: 'a-1', name: '接口清单', kind: 'doc', status: 'pending', file: '', sourceId: '', docId: '' }] : [],
      blockers: index === state ? [{ id: 'b-1', text: '缺数据', severity: 'high', resolved: false }] : [],
      decisions: index < state ? [{ id: `s-${index}`, outcome: 'go', rationale: '通过', decidedAt: '2026-10-02T00:00:00.000Z', legacy: false }] : [],
      noteFile: `projects/p-1/stages/${index}.md`,
    })),
  }
}

/** One fully populated state. */
function state() {
  return {
    schemaVersion: 2,
    revision: 3,
    updatedAt: '2026-10-03T00:00:00.000Z',
    migration: { legacyImportedAt: null, legacySchema: null, v2MigratedAt: null },
    projects: [project(1)],
    opportunities: [{
      id: 'o-1',
      title: '发票三单匹配',
      description: '现状：人工核对。目标：自动匹配。',
      proposer: '李四',
      domain: 'ap',
      taskType: 'validate',
      source: { type: 'meeting', meetingId: 'm-1' },
      ratings: { data: 4, rules: 4, review: 4, value: 4, adoption: 3 },
      compliance: 'medium',
      status: 'candidate',
      ai: null,
      file: 'opportunities/o-1.md',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    }],
    meetings: [{
      id: 'm-1',
      title: '月结访谈',
      date: '2026-10-01',
      attendees: ['张三', '李四'],
      file: 'meetings/m-1.md',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    }],
    research: [{
      id: 'r-1',
      title: '三单匹配调研',
      projectId: 'p-1',
      stage: 1,
      status: 'researching',
      question: '发票与订单如何关联？',
      conclusion: '需要主数据对齐。',
      file: 'projects/p-1/research/r-1.md',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    }],
    docs: [{
      id: 'd-1',
      title: '交付说明',
      template: 'delivery',
      projectId: 'p-1',
      stage: 1,
      status: 'draft',
      file: 'projects/p-1/documents/d-1/v1.md',
      currentVersion: 1,
      versions: [{ version: 1, file: 'projects/p-1/documents/d-1/v1.md', createdAt: '2026-10-01T00:00:00.000Z', source: 'create' }],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    }],
  }
}

/** Snapshot plus the fake store surface the components call. */
function snapshot(overrides = {}) {
  return {
    status: 'ready',
    error: null,
    state: state(),
    revision: 3,
    refreshToken: 1,
    root: '/data/workbench',
    ai: { available: true, provider: 'deepseek', model: 'deepseek-chat', modelName: 'DeepSeek', reason: null },
    readOnly: false,
    warnings: [],
    rootError: null,
    recovered: false,
    view: { section: 'overview' },
    files: {
      'projects/p-1/project.md': { status: 'ready', text: '# 应付账款对账', hash: 'h1', bytes: 10 },
      'projects/p-1/stages/1.md': { status: 'ready', text: '# 阶段备注', hash: 'h2', bytes: 10 },
      'meetings/m-1.md': { status: 'ready', text: '原始纪要', hash: 'h3', bytes: 10 },
      'projects/p-1/research/r-1.md': { status: 'ready', text: '# 调研', hash: 'h4', bytes: 10 },
      'projects/p-1/docs/d-1.md': { status: 'ready', text: '# 交付说明', hash: 'h5', bytes: 10 },
      'projects/p-1/documents/d-1/v1.md': { status: 'ready', text: '# 交付说明', hash: 'h5', bytes: 10 },
      'opportunities/o-1.md': { status: 'ready', text: '# 发票', hash: 'h6', bytes: 10 },
    },
    dirtyPaths: [],
    busy: false,
    aiRunning: null,
    handoffBusy: false,
    migration: null,
    toast: null,
    lastLegacy: null,
    ...overrides,
  }
}

/** A store that only answers reads. */
function fakeStore(initial) {
  let current = initial
  return {
    subscribe: () => () => {},
    getSnapshot: () => current,
    set(value) { current = value },
    load: async () => undefined,
    refresh: async () => undefined,
    setView(patch) { current = { ...current, view: { ...current.view, ...patch } } },
    mutate: async () => undefined,
    loadFile: async () => ({ status: 'ready', text: '', hash: 'h', bytes: 0 }),
    saveFile: async () => ({ hash: 'h2' }),
    runAi: async () => null,
    handoff: async () => ({ sessionId: 's-1', prompt: 'p' }),
    notify() {},
    dismissToast() {},
    setDirty() {},
    hasDirty: () => false,
    dispose() {},
  }
}

/** Render the panel and return its HTML. */
function render(snap, t = translator(zh)) {
  const store = fakeStore(snap)
  return renderToStaticMarkup(createElement(WorkbenchApp, {
    store,
    t,
    getLang: () => 'zh',
    locale: undefined,
  }))
}

test('render: overview shows metrics, stage path context, and the assistant', () => {
  const html = render(snapshot())
  assert.ok(html.includes('交付工作台'))
  assert.ok(html.includes('总览'))
  assert.ok(html.includes('应付账款对账'))
  assert.ok(html.includes('未解决阻塞'))
  assert.ok(html.includes('工作台助手'))
  assert.ok(html.includes('新建项目'))
  assert.ok(html.includes('下一步'))
})

test('render: empty workbench offers project creation', () => {
  const empty = snapshot({
    state: {
      schemaVersion: 2, revision: 0, updatedAt: '', migration: { legacyImportedAt: null, legacySchema: null, v2MigratedAt: null },
      projects: [], opportunities: [], meetings: [], research: [], docs: [],
    },
  })
  const html = render(empty)
  assert.ok(html.includes('从一个交付项目开始'))
  assert.ok(html.includes('创建项目'))
})

test('render: project detail shows the stage panel and read-only history', () => {
  const html = render(snapshot({ view: { section: 'projects', projectId: 'p-1', tab: 'stage', stage: 0 } }))
  assert.ok(html.includes('发现高价值问题'))
  assert.ok(html.includes('工作项 0.0'))
  assert.ok(html.includes('回看历史阶段'))
  assert.ok(html.includes('阶段备注'))
  assert.ok(html.includes('aria-label="阶段备注"'))
})

test('render: current stage renders fixed work, deliverables, evidence, blockers, and decision', () => {
  const html = render(snapshot({ view: { section: 'projects', projectId: 'p-1', tab: 'stage', stage: 1 } }))
  assert.ok(html.includes('记录决定'))
  assert.ok(html.includes('阶段产物'))
  assert.ok(html.includes('接口清单'))
  assert.ok(html.includes('缺数据'))
  assert.ok(html.includes('阶段决定'))
})

test('render: project center lists projects with status and next action', () => {
  const html = render(snapshot({ view: { section: 'projects' } }))
  assert.ok(html.includes('项目中心'))
  assert.ok(html.includes('应付账款对账'))
  assert.ok(html.includes('进行中'))
  assert.ok(html.includes('下一步'))
})

test('render: project home shows context, success criteria, risks, and evidence', () => {
  const html = render(snapshot({ view: { section: 'projects', projectId: 'p-1', tab: 'overview' } }))
  assert.ok(html.includes('业务背景'))
  assert.ok(html.includes('成功标准'))
  assert.ok(html.includes('对账时间缩短一半'))
  assert.ok(html.includes('风险与阻塞'))
  assert.ok(html.includes('缺数据'))
  assert.ok(html.includes('近期证据'))
})

test('render: project tabs expose tasks, sources, and document versions', () => {
  const tasks = render(snapshot({ view: { section: 'projects', projectId: 'p-1', tab: 'tasks' } }))
  assert.ok(tasks.includes('确认接口清单'))
  assert.ok(tasks.includes('时间线'))
  const sources = render(snapshot({ view: { section: 'projects', projectId: 'p-1', tab: 'sources' } }))
  assert.ok(sources.includes('访谈.md'))
  assert.ok(sources.includes('上传资料'))
  const docs = render(snapshot({ view: { section: 'docs', docId: 'd-1' } }))
  assert.ok(docs.includes('版本历史'))
  assert.ok(docs.includes('v1'))
})

test('render: current stage shows review status and fixed deliverables', () => {
  const html = render(snapshot({ view: { section: 'projects', projectId: 'p-1', tab: 'stage', stage: 1 } }))
  assert.ok(html.includes('阶段产物'))
  assert.ok(html.includes('缺失'))
  assert.ok(html.includes('评审阻断项'))
  assert.ok(html.includes('Go（推进一格）'))
})

test('render: task center aggregates open project tasks', () => {
  const html = render(snapshot({ view: { section: 'projects', taskCenter: true } }))
  assert.ok(html.includes('任务中心'))
  assert.ok(html.includes('确认接口清单'))
  assert.ok(html.includes('应付账款对账'))
})

test('render: current stage can link evidence to a project source', () => {
  const html = render(snapshot({ view: { section: 'projects', projectId: 'p-1', tab: 'stage', stage: 1 } }))
  assert.ok(html.includes('关联资料'))
  assert.ok(html.includes('访谈.md'))
})

test('render: research detail shows the body editor and AI run button', () => {
  const html = render(snapshot({ view: { section: 'research', researchId: 'r-1' } }))
  assert.ok(html.includes('三单匹配调研'))
  assert.ok(html.includes('发票与订单如何关联？'))
  assert.ok(html.includes('用 AI 归纳'))
  assert.ok(html.includes('保存正文'))
})

test('render: document detail shows the template, body, and drafting action', () => {
  const html = render(snapshot({ view: { section: 'docs', docId: 'd-1' } }))
  assert.ok(html.includes('交付说明'))
  assert.ok(html.includes('交付说明'))
  assert.ok(html.includes('用 AI 起草'))
  assert.ok(html.includes('草稿'))
})

test('render: opportunity detail shows the score, ratings, and AI assessment', () => {
  const html = render(snapshot({ view: { section: 'opportunities', opportunityId: 'o-1' } }))
  assert.ok(html.includes('发票三单匹配'))
  assert.ok(html.includes('78'))
  assert.ok(html.includes('可试点'))
  assert.ok(html.includes('用 AI 评估'))
  assert.ok(html.includes('数据就绪'))
})

test('render: meeting detail shows minutes and the extraction action', () => {
  const html = render(snapshot({ view: { section: 'meetings', meetingId: 'm-1' } }))
  assert.ok(html.includes('月结访谈'))
  assert.ok(html.includes('提取候选'))
  assert.ok(html.includes('纪要原文'))
  assert.ok(html.includes('aria-label="纪要原文"'))
})

test('render: AI unavailable disables the controls and explains why', () => {
  const html = render(snapshot({
    ai: { available: false, provider: '', model: '', reason: 'ai/no-llm' },
    view: { section: 'opportunities', opportunityId: 'o-1' },
  }))
  assert.ok(html.includes('AI 已关闭'))
  assert.ok(html.includes('当前组合没有挂载 LLM 服务'))
  assert.ok(html.includes('disabled'))
})

test('render: English copy renders the same shell', () => {
  const html = render(snapshot(), translator(en))
  assert.ok(html.includes('Delivery workbench'))
  assert.ok(html.includes('Overview'))
  assert.ok(html.includes('Workbench assistant'))
  assert.ok(html.includes('Next actions'))
})
