/** Shared test helpers: a throwaway data root per test. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchFiles } from '../src/host/files.js'
import { resolveConfig } from '../src/host/config.js'
import { WorkbenchStore } from '../src/host/store.js'

/** Create a temporary root and register cleanup on the test context. */
export async function tempRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'fde-workbench-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

/** Build the usual host pieces over a temporary root. */
export async function hostFixture(t, overrides = {}) {
  const root = await tempRoot(t)
  const config = resolveConfig({ root, ...overrides })
  const logger = { warn() {}, info() {} }
  const store = new WorkbenchStore({ root, limits: config.limits, logger })
  const files = new WorkbenchFiles({ root, limits: config.limits, logger })
  return { root, config, store, files, logger }
}

/** One legacy v2 snapshot with two projects, six opportunities, two meetings. */
export function legacyFixture() {
  const stages = (start, note = '') => Array.from({ length: 8 }, (_, index) => ({
    work: [
      { id: `w-${start}-${index}-0`, text: `work ${index}.0`, done: index < start },
      { id: `w-${start}-${index}-1`, text: `work ${index}.1`, done: false },
      { id: `w-${start}-${index}-2`, text: `work ${index}.2`, done: false },
    ],
    artifacts: index === start ? [{ id: `a-${start}`, name: '证据', kind: 'doc', status: 'pending' }] : [],
    blockers: index === start ? [{ id: `b-${start}`, text: '缺数据', severity: 'high' }] : [],
    decisions: index < start ? [{ id: `s-${start}-${index}`, at: '2026-09-10T00:00:00.000Z', decision: `阶段 ${index} 通过` }] : [],
    note: index === 0 ? note : '',
  }))
  const opportunity = (id, title, meetingId, domain, taskType) => ({
    id,
    title,
    description: `${title} 的现状与目标`,
    proposer: '李四',
    domain,
    taskType,
    source: { type: 'meeting', meetingId },
    ratings: { data: 4, rules: 4, review: 4, value: 4, adoption: 3 },
    compliance: 'medium',
    status: 'candidate',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  })
  return {
    version: 2,
    view: 'overview',
    selectedProjectId: 'p-alpha',
    selectedStage: 3,
    selectedMeetingId: 'm-1',
    projects: [
      {
        id: 'p-alpha',
        name: '应付账款对账',
        customer: 'ACME',
        owner: '张三',
        targetDate: '2026-12-31',
        createdAt: '2026-09-01T00:00:00.000Z',
        currentStage: 3,
        deliveredAt: null,
        stages: stages(3, '第三阶段备注'),
      },
      {
        id: 'p-beta',
        name: '费用报销审核',
        customer: 'Beta',
        owner: '王五',
        targetDate: '',
        createdAt: '2026-09-03T00:00:00.000Z',
        currentStage: 1,
        deliveredAt: null,
        stages: stages(1, '第一阶段备注'),
      },
    ],
    opportunities: [
      opportunity('o-1', '发票三单匹配', 'm-1', 'ap', 'validate'),
      opportunity('o-2', '月结凭证摘要', 'm-1', 'close', 'generate'),
      opportunity('o-3', '应收账龄周报', 'm-2', 'ar', 'summarize'),
      opportunity('o-4', '报销单据识别', 'm-2', 'expense', 'extract'),
      opportunity('o-5', '税务申报检查', 'm-1', 'tax', 'validate'),
      opportunity('o-6', '预算差异分析', 'm-2', 'fpa', 'analyze'),
    ],
    meetings: [
      {
        id: 'm-1',
        title: '财务月结访谈',
        date: '2026-09-05',
        attendees: ['张三', '李四'],
        notes: '报销单据越来越多，能不能自动识别发票、核对预算，再让人复核？\n- 月结凭证摘要每次都靠人写',
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
      {
        id: 'm-2',
        title: '应收流程走访',
        date: '2026-09-06',
        attendees: ['王五'],
        notes: '应收账龄周报需要手工汇总，容易漏项。',
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
      },
    ],
  }
}
