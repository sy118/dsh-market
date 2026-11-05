/**
 * The contract an agent reads before touching the workbench.
 *
 * The file is rewritten only when its content changes, so opening the
 * workbench repeatedly does not churn the workspace.
 */
import {
  ARTIFACT_KINDS,
  ARTIFACT_STATUSES,
  COMPLIANCE_LEVELS,
  DECISION_OUTCOMES,
  DOC_STATUSES,
  DOC_TEMPLATES,
  DOMAINS,
  OPP_STATUSES,
  PROJECT_STATUSES,
  RESEARCH_STATUSES,
  SCHEMA_VERSION,
  SEVERITIES,
  SOURCE_TYPES,
  STAGE_COUNT,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../shared/constants.js'
import { STAGES } from '../shared/stages.js'

/** Stable marker used to detect a stale generated file. */
export const AGENTS_MARKER = `<!-- fde-workbench: schema ${SCHEMA_VERSION} -->`

/** Render the current data contract. */
export function renderAgentsMd() {
  const list = values => values.join(' | ')
  const stageLines = STAGES.map((stage, index) => (
    `${index + 1}. ${stage.title.zh}（${stage.id}）：${stage.artifacts.filter(item => item.required).map(item => item.path).join('、')}`
  )).join('\n')
  return `${AGENTS_MARKER}
# 交付工作台数据目录（FDE delivery workbench）

本目录由 DSH 插件 \`@acme-community/fde-workbench\` 管理。你可以读写这里的文件，但请遵守下面的规则。

## 目录结构

- \`workbench.json\` — 项目索引与全局结构化记录（项目摘要、机会、会议、调研、文档元数据）；\`schemaVersion\` 当前为 ${SCHEMA_VERSION}。
- \`projects/<projectId>/project.md\` — 项目背景、目标、范围与干系人正文。
- \`projects/<projectId>/stages/<0-7>.md\` — 某个阶段的备注正文。
- \`projects/<projectId>/.fde/project.json\` — 项目状态、当前阶段、返回与重评范围。
- \`projects/<projectId>/.fde/stages/<stageId>.json\` — 工作项、产物状态、阻塞与决定（由工作台同步）。
- \`projects/<projectId>/.fde/tasks.json\`、\`sources.json\`、\`documents.json\` — 任务、资料与文档元数据。
- \`projects/<projectId>/fde-deliverables/…\` — 阶段固定产物；每阶段 3 份必需产物（第一阶段另有 1 份可选）。
- \`projects/<projectId>/sources/…\` — 上传的资料原件与版本。
- \`projects/<projectId>/documents/<docId>/vN.md\` — 文档版本；每次保存新增版本，不覆盖旧文件。
- \`projects/<projectId>/research/<researchId>.md\`、\`docs/<docId>.md\` — 兼容旧路径。
- \`meetings/<meetingId>.md\`、\`opportunities/<opportunityId>.md\` — 会议与机会正文。

## 阶段固定产物

${stageLines}

## 读写规则

1. 优先修改 Markdown 正文与固定产物；结构化字段（状态、决定、评分、依赖）在 \`workbench.json\` 中。
2. 不要修改 \`schemaVersion\`；不要手工把 \`revision\` 改小；新增记录时生成新的唯一 id（前缀见下）。
3. 不要删除或移动别人的记录；需要删除时在回复里说明，由人确认后在工作台里操作。
4. **阶段决定必须由人确认。** 你可以补齐产物、整理证据、提出建议，但不要写入 \`currentStage\`、\`status\`、四类决定或返回记录。
5. 只有当前阶段可编辑；已完成、已停止、暂停或未来阶段都不得写入。
6. **文件存在不等于证据通过。** 产物状态由宿主按“存在、普通文件、非空”计算；不要用空文件或自评冒充产物。
7. 返回上一阶段必须由人填写原因；返回会保留全部产物与历史，不会删除文件。
8. AI 评分是建议，不是结论；不要因为分数高就改 \`status\`。
9. 保持 JSON 有效：写完后检查逗号、引号与括号。
10. 只写 \`.md\`、\`.json\` 与资料原件；不要创建可执行文件、脚本或依赖目录。

## 阶段决定

- \`go\`：仅 \`review-ready\`（4 个工作项完成 + 3 份必需产物 present + 无 high/critical 未解决阻塞）可用；推进一格。
- \`revise\` / \`narrow\`：留在本阶段，记录理由。
- \`stop\`：项目停止，后续推进与返回被拒绝。
- 返回：只能退一格、必须填写原因；从目标阶段到原阶段需要重新确认。

## workbench.json 结构

\`\`\`json
{
  "schemaVersion": ${SCHEMA_VERSION},
  "revision": 0,
  "updatedAt": "ISO-8601",
  "migration": { "legacyImportedAt": null, "legacySchema": null, "v2MigratedAt": null },
  "projects": [],
  "opportunities": [],
  "meetings": [],
  "research": [],
  "docs": []
}
\`\`\`

- project: \`id,name,customer,owner,startDate,endDate,status,successCriteria,stakeholders,createdAt,updatedAt,currentStage,deliveredAt,reconfirmThrough,returns[],tasks[],sources[],file,stages[${STAGE_COUNT}]\`
- stage: \`id,work[4],deliverables[],artifacts[],blockers[],decisions[],noteFile\`
- deliverable: \`id,title,path,required,status(present|missing|error),bytes,hash,updatedAt,error\`
- task: \`id,title,status,priority,owner,startDate,dueDate,progress,dependencyIds[],blockedReason,stage,createdAt,updatedAt\`
- source: \`id,name,mime,bytes,sha256,version,path,createdAt,replacedAt\`
- doc: \`id,title,template,projectId,stage,status,file,versions[],currentVersion,createdAt,updatedAt\`
- decision: \`id,outcome,rationale,decidedBy,decidedAt,evidenceDigest,fromStage,toStage,revision,legacy\`

## 枚举

- project.status: ${list(PROJECT_STATUSES)}
- decision.outcome: ${list(DECISION_OUTCOMES)}
- task.status: ${list(TASK_STATUSES)}
- task.priority: ${list(TASK_PRIORITIES)}
- domain: ${list(DOMAINS)}
- taskType: ${list(TASK_TYPES)}
- opportunity.status: ${list(OPP_STATUSES)}
- compliance: ${list(COMPLIANCE_LEVELS)}
- source.type: ${list(SOURCE_TYPES)}
- artifact.kind: ${list(ARTIFACT_KINDS)}
- artifact.status: ${list(ARTIFACT_STATUSES)}
- blocker.severity: ${list(SEVERITIES)}
- research.status: ${list(RESEARCH_STATUSES)}
- doc.status: ${list(DOC_STATUSES)}
- doc.template: ${list(DOC_TEMPLATES)}

## id 前缀

项目 \`p-\`、机会 \`o-\`、会议 \`m-\`、调研 \`r-\`、文档 \`d-\`、工作项 \`w-\`、证据 \`a-\`、阻塞 \`b-\`、决定/返回 \`s-\`、任务 \`t-\`、资料 \`f-\`。
`
}

/**
 * Ensure `<root>/AGENTS.md` matches the current contract.
 * @param {object} options - files facade and logger.
 * @returns {Promise<{written: boolean, path: string}>}
 */
export async function ensureAgentsMd(options) {
  const { files, logger } = options
  const path = 'AGENTS.md'
  const next = renderAgentsMd()
  let current = ''
  try {
    current = (await files.read(path)).text
  } catch (error) {
    if (error.code !== 'file/not-found') throw error
  }
  if (current === next) return { written: false, path }
  await files.write(path, next, null)
  logger?.info?.('fde-workbench: AGENTS.md updated')
  return { written: true, path }
}
