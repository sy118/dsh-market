/**
 * The delivery contract: eight stages, four fixed work items each, and the
 * three required artifacts that make a stage reviewable. Host and client share
 * this module so a stage cannot exist in the UI without a host definition.
 */
export const STAGES = [
  {
    id: 'discovery',
    title: { zh: '发现高价值问题', en: 'Find the valuable problem' },
    question: { zh: '真实问题是什么，值得做吗？', en: 'What is the real problem, and is it worth doing?' },
    work: [
      { id: 'collect', text: { zh: '收集原始材料并记录来源标识', en: 'Collect source material and record its provenance' } },
      { id: 'restore', text: { zh: '还原真实工作流与例外情况', en: 'Restore the real workflow and its exceptions' } },
      { id: 'value', text: { zh: '核对问题价值、基线与停止条件', en: 'Check the value, baseline, and stop conditions' } },
      { id: 'conclude', text: { zh: '形成阶段结论与待确认事项', en: 'Form the stage conclusion and open questions' } },
    ],
    artifacts: [
      { id: 'discovery-report', title: { zh: '现场发现记录', en: 'Discovery record' }, path: 'fde-deliverables/01-discovery/discovery-report.md', required: true },
      { id: 'confirmation-checklist', title: { zh: '事实确认清单', en: 'Confirmation checklist' }, path: 'fde-deliverables/01-discovery/confirmation-checklist.md', required: true },
      { id: 'problem-baseline', title: { zh: '问题与基线说明', en: 'Problem and baseline' }, path: 'fde-deliverables/01-discovery/problem-baseline.md', required: true },
      { id: 'engagement-reframe', title: { zh: '项目重新界定记录', en: 'Engagement reframe' }, path: 'fde-deliverables/01-discovery/engagement-reframe.md', required: false },
    ],
  },
  {
    id: 'definition',
    title: { zh: '定义结果、范围与责任', en: 'Define outcomes, scope, and ownership' },
    question: { zh: '做到什么算成功，由谁负责？', en: 'What counts as success, and who owns the result?' },
    work: [
      { id: 'baseline', text: { zh: '建立当前基线', en: 'Establish the current baseline' } },
      { id: 'outcome', text: { zh: '明确成功标准与衡量方式', en: 'Define success criteria and measurement' } },
      { id: 'scope', text: { zh: '划定范围、非目标与停止条件', en: 'Draw scope, non-goals, and stop conditions' } },
      { id: 'ownership', text: { zh: '确认决定人、执行人与交付节奏', en: 'Confirm decision makers, owners, and cadence' } },
    ],
    artifacts: [
      { id: 'outcome-contract', title: { zh: '业务结果与范围约定', en: 'Outcome and scope contract' }, path: 'fde-deliverables/02-definition/outcome-contract.md', required: true },
      { id: 'value-case', title: { zh: '价值测算记录', en: 'Value case' }, path: 'fde-deliverables/02-definition/value-case.md', required: true },
      { id: 'delivery-plan', title: { zh: '交付计划', en: 'Delivery plan' }, path: 'fde-deliverables/02-definition/delivery-plan.md', required: true },
    ],
  },
  {
    id: 'investigation',
    title: { zh: '调查现场条件', en: 'Investigate the site' },
    question: { zh: '数据、系统、接口、安全与组织是否支持？', en: 'Do data, systems, interfaces, security, and the organization support it?' },
    work: [
      { id: 'data', text: { zh: '检查数据来源、质量与敏感性', en: 'Check data sources, quality, and sensitivity' } },
      { id: 'systems', text: { zh: '梳理系统、接口与调用链', en: 'Map systems, interfaces, and call chains' } },
      { id: 'access', text: { zh: '核对账号、权限、安全与法务', en: 'Check accounts, permissions, security, and legal' } },
      { id: 'owners', text: { zh: '确认现场责任人与等待事项', en: 'Confirm on-site owners and waiting items' } },
    ],
    artifacts: [
      { id: 'data-readiness', title: { zh: '数据可用性评估', en: 'Data readiness' }, path: 'fde-deliverables/03-investigation/data-readiness.md', required: true },
      { id: 'system-access-map', title: { zh: '系统与访问清单', en: 'System and access map' }, path: 'fde-deliverables/03-investigation/system-access-map.md', required: true },
      { id: 'governance-review', title: { zh: '安全与治理核对记录', en: 'Security and governance review' }, path: 'fde-deliverables/03-investigation/governance-review.md', required: true },
    ],
  },
  {
    id: 'design',
    title: { zh: '设计方案与纵向切片', en: 'Design the solution and vertical slice' },
    question: { zh: '用什么机制把关键链路跑通？', en: 'Which mechanism makes the critical path work end to end?' },
    work: [
      { id: 'mechanism', text: { zh: '比较实现方式并说明取舍', en: 'Compare mechanisms and record the trade-offs' } },
      { id: 'architecture', text: { zh: '明确系统边界、工具权限与回退', en: 'Define system boundaries, tool permissions, and fallback' } },
      { id: 'slice', text: { zh: '验证最小端到端业务流程', en: 'Validate a minimal end-to-end slice' } },
      { id: 'decision', text: { zh: '记录方案决定与待确认事项', en: 'Record the solution decision and open items' } },
    ],
    artifacts: [
      { id: 'mechanism-selection', title: { zh: '实现方式选择记录', en: 'Mechanism selection' }, path: 'fde-deliverables/04-design/mechanism-selection.md', required: true },
      { id: 'solution-design', title: { zh: '生产方案设计', en: 'Solution design' }, path: 'fde-deliverables/04-design/solution-design.md', required: true },
      { id: 'vertical-slice-record', title: { zh: '最小业务流程验证记录', en: 'Vertical slice record' }, path: 'fde-deliverables/04-design/vertical-slice-record.md', required: true },
    ],
  },
  {
    id: 'evaluation',
    title: { zh: '运行 PoC 与 Eval', en: 'Run the PoC and eval' },
    question: { zh: '开发出的系统是否达到目标？', en: 'Does the built system meet its targets?' },
    work: [
      { id: 'plan', text: { zh: '制定验证计划与指标', en: 'Define the evaluation plan and metrics' } },
      { id: 'cases', text: { zh: '准备真实、边界与失败案例', en: 'Prepare real, edge, and failure cases' } },
      { id: 'run', text: { zh: '运行 PoC/Eval 并保存证据', en: 'Run the PoC/eval and preserve evidence' } },
      { id: 'conclusion', text: { zh: '形成验证结论与失败复盘', en: 'Form the conclusion and failure review' } },
    ],
    artifacts: [
      { id: 'evaluation-plan', title: { zh: '验证计划', en: 'Evaluation plan' }, path: 'fde-deliverables/05-evaluation/evaluation-plan.md', required: true },
      { id: 'evaluation-report', title: { zh: '验证报告', en: 'Evaluation report' }, path: 'fde-deliverables/05-evaluation/evaluation-report.md', required: true },
      { id: 'evaluation-baseline', title: { zh: '验证基线', en: 'Evaluation baseline' }, path: 'fde-deliverables/05-evaluation/evaluation-baseline.md', required: true },
    ],
  },
  {
    id: 'pilot',
    title: { zh: '集成、可靠性与受控试点', en: 'Integrate, harden, and pilot' },
    question: { zh: '能否在明确边界内进入现场试点？', en: 'Can it enter an on-site pilot within clear boundaries?' },
    work: [
      { id: 'integration', text: { zh: '完成企业系统与数据接入', en: 'Complete enterprise system and data integration' } },
      { id: 'reliability', text: { zh: '补齐监控、降级、恢复与审计', en: 'Add monitoring, degradation, recovery, and audit' } },
      { id: 'readiness', text: { zh: '确认试点范围、人员与回滚', en: 'Confirm pilot scope, staff, and rollback' } },
      { id: 'pilot', text: { zh: '运行受控试点并记录结果', en: 'Run the controlled pilot and record results' } },
    ],
    artifacts: [
      { id: 'pilot-scope', title: { zh: '试点范围与授权', en: 'Pilot scope and authorization' }, path: 'fde-deliverables/06-pilot/pilot-scope.md', required: true },
      { id: 'pilot-runbook', title: { zh: '试点运行与回滚手册', en: 'Pilot runbook and rollback' }, path: 'fde-deliverables/06-pilot/pilot-runbook.md', required: true },
      { id: 'pilot-report', title: { zh: '试点结果记录', en: 'Pilot report' }, path: 'fde-deliverables/06-pilot/pilot-report.md', required: true },
    ],
  },
  {
    id: 'production',
    title: { zh: '生产、采用与验收交接', en: 'Launch, adopt, and hand over' },
    question: { zh: '谁接收，如何使用，怎样逐项验收？', en: 'Who receives it, how is it used, and how is each item accepted?' },
    work: [
      { id: 'readiness', text: { zh: '审查生产就绪与发布窗口', en: 'Review production readiness and the release window' } },
      { id: 'release', text: { zh: '受控进入生产并保存发布证据', en: 'Enter production under control and preserve release evidence' } },
      { id: 'adoption', text: { zh: '推动采用并记录业务结果', en: 'Drive adoption and record business results' } },
      { id: 'handover', text: { zh: '完成培训与运维责任移交', en: 'Complete training and operations handover' } },
    ],
    artifacts: [
      { id: 'production-review', title: { zh: '生产就绪与发布记录', en: 'Production review and release record' }, path: 'fde-deliverables/07-production/production-review.md', required: true },
      { id: 'customer-acceptance', title: { zh: '客户验收记录', en: 'Customer acceptance record' }, path: 'fde-deliverables/07-production/customer-acceptance.md', required: true },
      { id: 'handover-record', title: { zh: '培训与责任移交记录', en: 'Training and handover record' }, path: 'fde-deliverables/07-production/handover-record.md', required: true },
    ],
  },
  {
    id: 'improvement',
    title: { zh: '持续改进与沉淀', en: 'Improve and reuse' },
    question: { zh: '上线后如何持续解决现场问题？', en: 'How does the team keep solving on-site problems after launch?' },
    work: [
      { id: 'evidence', text: { zh: '汇总运行指标、反馈与成本', en: 'Aggregate runtime metrics, feedback, and cost' } },
      { id: 'prioritize', text: { zh: '选择本轮改进事项与不做项', en: 'Choose this round of improvements and non-goals' } },
      { id: 'validate', text: { zh: '验证改进并受控发布', en: 'Validate the improvement and release under control' } },
      { id: 'productize', text: { zh: '沉淀可复用方法与组件', en: 'Capture reusable methods and components' } },
    ],
    artifacts: [
      { id: 'field-learning-register', title: { zh: '现场经验登记', en: 'Field learning register' }, path: 'fde-deliverables/08-improvement/field-learning-register.md', required: true },
      { id: 'improvement-record', title: { zh: '改进与验证记录', en: 'Improvement and validation record' }, path: 'fde-deliverables/08-improvement/improvement-record.md', required: true },
      { id: 'controlled-release-record', title: { zh: '受控发布记录', en: 'Controlled release record' }, path: 'fde-deliverables/08-improvement/controlled-release-record.md', required: true },
    ],
  },
]

/** One stage definition by index, clamped to the known path. */
export function stageDefinition(index) {
  const safe = Math.min(STAGES.length - 1, Math.max(0, Number(index) || 0))
  return STAGES[safe]
}

/** Localized stage title. */
export function stageTitleOf(index, locale = 'zh') {
  return stageDefinition(index).title[locale === 'en' ? 'en' : 'zh']
}

/** Localized stage question. */
export function stageQuestionOf(index, locale = 'zh') {
  return stageDefinition(index).question[locale === 'en' ? 'en' : 'zh']
}
