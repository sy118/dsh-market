/**
 * The first message a handed-off DSH session receives.
 *
 * It names the data root, the scope, the files to read first, and the rules an
 * agent must follow. The prompt is data-only: no tool schemas are installed.
 */
import { STAGE_COUNT } from '../shared/constants.js'
import { stageTemplates } from '../shared/stage-templates.js'
import { WorkbenchError } from './paths.js'

/** Resolve one scope to a title, a description, and the files to read. */
export function resolveScope(scope, state, locale) {
  const kind = scope !== null && typeof scope === 'object' ? scope.kind : 'workspace'
  const id = typeof scope?.id === 'string' ? scope.id : ''
  if (kind === 'project') {
    const project = state.projects.find(item => item.id === id)
    if (project === undefined) throw new WorkbenchError('project/not-found', 404, `no project ${id}`)
    const files = [project.file, ...state.research.filter(item => item.projectId === id).map(item => item.file)]
    return {
      title: project.name,
      description: `项目「${project.name}」，当前第 ${project.currentStage + 1}/8 阶段。`,
      files,
      kind,
      id,
    }
  }
  if (kind === 'stage') {
    const project = state.projects.find(item => item.id === id)
    if (project === undefined) throw new WorkbenchError('project/not-found', 404, `no project ${id}`)
    const index = Number(scope.stage)
    if (!Number.isInteger(index) || index < 0 || index >= STAGE_COUNT) {
      throw new WorkbenchError('stage/invalid', 400, 'stage must be an integer between 0 and 7')
    }
    const copy = stageTemplates(locale)[index]
    const note = project.stages[index].noteFile
    return {
      title: `${project.name} · ${copy.title}`,
      description: `项目「${project.name}」第 ${index + 1} 阶段「${copy.title}」，本阶段要回答：${copy.question}`,
      files: [project.file, ...(note === '' ? [] : [note])],
      kind,
      id,
      stage: index,
    }
  }
  if (kind === 'opportunity') {
    const opportunity = state.opportunities.find(item => item.id === id)
    if (opportunity === undefined) throw new WorkbenchError('opportunity/not-found', 404, `no opportunity ${id}`)
    const meeting = state.meetings.find(item => item.id === opportunity.source.meetingId)
    return {
      title: opportunity.title,
      description: `AI 机会「${opportunity.title}」，领域 ${opportunity.domain}，动作 ${opportunity.taskType}。`,
      files: [opportunity.file, ...(meeting === undefined ? [] : [meeting.file])],
      kind,
      id,
    }
  }
  if (kind === 'meeting') {
    const meeting = state.meetings.find(item => item.id === id)
    if (meeting === undefined) throw new WorkbenchError('meeting/not-found', 404, `no meeting ${id}`)
    return {
      title: meeting.title,
      description: `会议或访谈「${meeting.title}」，日期 ${meeting.date}。`,
      files: [meeting.file],
      kind,
      id,
    }
  }
  if (kind === 'research') {
    const research = state.research.find(item => item.id === id)
    if (research === undefined) throw new WorkbenchError('research/not-found', 404, `no research ${id}`)
    return {
      title: research.title,
      description: `调研「${research.title}」。`,
      files: [research.file],
      kind,
      id,
    }
  }
  if (kind === 'doc') {
    const doc = state.docs.find(item => item.id === id)
    if (doc === undefined) throw new WorkbenchError('doc/not-found', 404, `no document ${id}`)
    return {
      title: doc.title,
      description: `交付文档「${doc.title}」，状态 ${doc.status}。`,
      files: [doc.file],
      kind,
      id,
    }
  }
  return {
    title: '交付工作台',
    description: `工作台总览：${state.projects.length} 个项目，${state.opportunities.length} 条机会，${state.meetings.length} 场会议。`,
    files: ['AGENTS.md', 'workbench.json'],
    kind: 'workspace',
    id: '',
  }
}

/** Render the first message. */
export function renderHandoffPrompt(input) {
  const { root, scope, locale } = input
  const zh = locale !== 'en'
  if (!zh) {
    return `You are the delivery workbench assistant inside DSH. The workbench data root is:
${root}

Scope: ${scope.title}
${scope.description}

Read these files first:
${scope.files.map(path => `- ${path}`).join('\n')}

Read ${root}/AGENTS.md before editing anything. It defines the directory layout, record fields, and editing rules.

Working rules:
- Read AGENTS.md and the current project's .fde/ files first. Only edit .md bodies, fixed deliverables, and workbench.json under the data root. Keep ids stable and JSON valid.
- Only the current stage of an active project is writable. Never change currentStage, project status, review state, returns, or the four decisions.
- Fill the stage's required artifacts with real facts and evidence. An empty file or an Agent summary is not a passed artifact.
- You may collect evidence, draft documents, and propose scores. Go/Revise/Narrow/Stop and score acceptance are human decisions made in the workbench.
- Prefer editing Markdown bodies; put structured changes in workbench.json and explain them in your reply.
- When you finish, summarise what you read, what you changed, and what still needs a human decision.`
  }
  return `你是 DSH 中的交付工作台助手。工作台数据目录是：
${root}

处理范围：${scope.title}
${scope.description}

请先阅读这些文件：
${scope.files.map(path => `- ${path}`).join('\n')}

编辑前先读 ${root}/AGENTS.md，其中写明目录结构、记录字段与编辑规则。

工作规则：
- 先读 AGENTS.md 与当前项目的 .fde/ 文件；只修改数据目录下的 .md、固定产物与 workbench.json，保持 id 不变并保证 JSON 有效。
- 只有 active 项目的当前阶段可写；不要改 currentStage、项目状态、评审状态、返回记录或四类决定。
- 用真实事实与证据补齐当前阶段的必需产物；空文件或 Agent 自述不算产物通过。
- 可以整理证据、起草文档、提出评分建议；Go/Revise/Narrow/Stop 与评分采纳由人在工作台里确认。
- 优先改 Markdown 正文；结构化改动写进 workbench.json，并在回复中说明。
- 完成后汇报：读了什么、改了什么、还有哪些需要人决定。`
}
