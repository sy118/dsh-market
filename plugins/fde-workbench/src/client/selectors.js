/**
 * Pure selectors for the workbench UI.
 *
 * Keeping counts, sorting, stage state, and next-action derivation here makes
 * them testable without React and keeps components about layout.
 */
import { DIMENSIONS, STAGE_COUNT } from '../shared/constants.js'
import { scoreOpportunity } from '../shared/scoring.js'
import { stageState as deriveStageState } from '../shared/stage-state.js'
import { stageTemplates } from '../shared/stage-templates.js'

/** Whether a project is completed. */
export function isDelivered(project) {
  return project?.status === 'completed' || (typeof project?.deliveredAt === 'string' && project.deliveredAt !== '')
}

/** Whether a project accepts no more stage work. */
export function isClosed(project) {
  return isDelivered(project) || project?.status === 'stopped'
}

/** Whether a project is running normally. */
export function isActive(project) {
  return project?.status === 'active'
}

/** Derived review state for one stage record. */
export function stageReview(stage) {
  return deriveStageState(stage)
}

/** `done`, `current`, `paused`, or `todo` for one stage. */
export function stageState(project, index) {
  if (isDelivered(project)) return 'done'
  if (index < project.currentStage) return 'done'
  if (index === project.currentStage) return project.status === 'paused' ? 'paused' : 'current'
  return 'todo'
}

/** Completed and total work items in one stage. */
export function workProgress(stage) {
  const total = stage.work.length
  const done = stage.work.filter(item => item.done).length
  return { done, total }
}

/** Unresolved blockers across a project. */
export function openBlockers(project) {
  return (project?.stages ?? []).reduce((sum, stage) => sum + (stage.blockers ?? []).filter(item => !item.resolved).length, 0)
}

/** Unresolved high/critical blockers in one stage. */
export function reviewBlockersOf(stage) {
  return (stage?.blockers ?? []).filter(item => !item.resolved && (item.severity === 'high' || item.severity === 'critical'))
}

/** The concrete next action for one project. */
export function projectNextAction(project) {
  if (project === undefined || project === null) return null
  if (isDelivered(project)) return { code: 'completed' }
  if (project.status === 'stopped') return { code: 'stopped' }
  if (project.status === 'paused') return { code: 'resume' }
  const stage = project.stages[project.currentStage]
  if (stage === undefined) return { code: 'stage' }
  const derived = deriveStageState(stage)
  if (derived.status === 'blocked') return { code: 'blocked', count: reviewBlockersOf(stage).length }
  if (derived.status === 'review-ready') return { code: 'decide', stage: project.currentStage }
  const work = (stage.work ?? []).filter(item => !item.done).length
  if (work > 0) return { code: 'work', count: work, stage: project.currentStage }
  const missing = (stage.deliverables ?? []).filter(item => item.required !== false && item.status !== 'present')
  if (missing.length > 0) return { code: 'artifact', count: missing.length, stage: project.currentStage }
  return { code: 'stage', stage: project.currentStage }
}

/** Filter and search projects for the portfolio. */
export function filterProjects(projects, filters = {}) {
  const query = (filters.query ?? '').trim().toLowerCase()
  return [...(projects ?? [])]
    .filter(project => filters.status === undefined || filters.status === '' || project.status === filters.status)
    .filter(project => filters.stage === undefined || filters.stage === '' || String(project.currentStage) === String(filters.stage))
    .filter(project => query === ''
      || project.name.toLowerCase().includes(query)
      || project.customer.toLowerCase().includes(query)
      || project.owner.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftDone = isDelivered(left) ? 1 : 0
      const rightDone = isDelivered(right) ? 1 : 0
      if (leftDone !== rightDone) return leftDone - rightDone
      return String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt))
    })
}

/** Flattened recent evidence for one project. */
export function projectEvidence(project, limit = 6) {
  const rows = []
  for (let index = 0; index < (project?.stages ?? []).length; index += 1) {
    for (const item of project.stages[index].artifacts ?? []) {
      rows.push({
        kind: 'evidence',
        id: item.id,
        title: item.name,
        status: item.status,
        stage: index,
        at: project.updatedAt,
      })
    }
    for (const item of project.stages[index].deliverables ?? []) {
      if (item.status !== 'present') continue
      rows.push({
        kind: 'deliverable',
        id: item.id,
        title: item.title,
        status: item.status,
        stage: index,
        at: item.updatedAt ?? project.updatedAt,
      })
    }
  }
  return rows.sort((left, right) => String(right.at).localeCompare(String(left.at))).slice(0, limit)
}

/** All open project tasks, with the owning project attached. */
export function taskCenter(state) {
  const rows = []
  for (const project of state?.projects ?? []) {
    for (const task of project.tasks ?? []) {
      if (task.status === 'done' || task.status === 'cancelled') continue
      rows.push({ ...task, projectId: project.id, projectName: project.name })
    }
  }
  return rows.sort((left, right) => {
    const leftDue = left.dueDate === '' ? '9999-12-31' : left.dueDate
    const rightDue = right.dueDate === '' ? '9999-12-31' : right.dueDate
    return leftDue.localeCompare(rightDue)
  })
}

/** Format one project task as a gantt row, or null when it has no dates. */
export function ganttRow(task, range) {
  if (task.startDate === '' || task.dueDate === '') return null
  const start = Date.parse(task.startDate)
  const end = Date.parse(task.dueDate)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  const total = range.end - range.start
  if (total <= 0) return null
  return {
    id: task.id,
    title: task.title,
    left: Math.max(0, Math.min(100, ((start - range.start) / total) * 100)),
    width: Math.max(1, Math.min(100, ((end - start + 86_400_000) / total) * 100)),
    dependencyIds: task.dependencyIds ?? [],
  }
}

/** Date range for the read-only gantt. */
export function ganttRange(project) {
  const dates = []
  for (const task of project?.tasks ?? []) {
    if (task.startDate !== '') dates.push(Date.parse(task.startDate))
    if (task.dueDate !== '') dates.push(Date.parse(task.dueDate))
  }
  if (dates.length === 0) return null
  return { start: Math.min(...dates), end: Math.max(...dates) }
}

/** Workbench-wide metrics and stage distribution. */
export function overviewStats(state) {
  const projects = state?.projects ?? []
  const active = projects.filter(project => (project.status === undefined || project.status === 'active') && !isDelivered(project)).length
  const paused = projects.filter(project => project.status === 'paused').length
  const delivered = projects.filter(project => isDelivered(project)).length
  const stopped = projects.filter(project => project.status === 'stopped').length
  const blockers = projects.reduce((sum, project) => sum + openBlockers(project), 0)
  const byStage = Array.from({ length: STAGE_COUNT }, (_, index) => (
    projects.filter(project => !isDelivered(project) && project.status !== 'stopped' && project.currentStage === index).length
  ))
  return {
    projects: projects.length,
    active,
    paused,
    delivered,
    stopped,
    blockers,
    byStage,
    opportunities: state?.opportunities?.length ?? 0,
    meetings: state?.meetings?.length ?? 0,
    research: state?.research?.length ?? 0,
    docs: state?.docs?.length ?? 0,
  }
}

/** Recent changes across every collection. */
export function recentActivity(state, limit = 6) {
  const items = []
  for (const project of state?.projects ?? []) {
    const at = project.createdAt
    items.push({ kind: 'project', id: project.id, title: project.name, at })
  }
  for (const opportunity of state?.opportunities ?? []) {
    items.push({ kind: 'opportunity', id: opportunity.id, title: opportunity.title, at: opportunity.updatedAt })
  }
  for (const meeting of state?.meetings ?? []) {
    items.push({ kind: 'meeting', id: meeting.id, title: meeting.title, at: meeting.updatedAt })
  }
  for (const research of state?.research ?? []) {
    items.push({ kind: 'research', id: research.id, title: research.title, at: research.updatedAt })
  }
  for (const doc of state?.docs ?? []) {
    items.push({ kind: 'doc', id: doc.id, title: doc.title, at: doc.updatedAt })
  }
  return items
    .filter(item => typeof item.at === 'string' && item.at !== '')
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, limit)
}

/** Concrete next actions, with the parameters their copy needs. */
export function nextActions(state, limit = 5) {
  const actions = []
  for (const project of state?.projects ?? []) {
    if (isDelivered(project) || project.status === 'stopped') continue
    if (project.status === 'paused') {
      actions.push({ code: 'resume', projectId: project.id, name: project.name, weight: 70 })
      continue
    }
    const blocked = openBlockers(project)
    if (blocked > 0) {
      actions.push({ code: 'blocked', count: blocked, projectId: project.id, name: project.name, weight: 100 + blocked })
      continue
    }
    const next = projectNextAction(project)
    if (next?.code === 'decide') {
      actions.push({ code: 'decide', projectId: project.id, name: project.name, weight: 80 })
    } else if (next?.code === 'artifact') {
      actions.push({ code: 'artifact', count: next.count, projectId: project.id, name: project.name, weight: 75 })
    } else if (next?.code === 'work') {
      actions.push({ code: 'work', count: next.count, projectId: project.id, name: project.name, weight: 65 })
    }
    if (project.currentStage === STAGE_COUNT - 1) {
      actions.push({ code: 'deliver', projectId: project.id, name: project.name, weight: 90 })
    }
  }
  const candidates = (state?.opportunities ?? []).filter(item => item.status === 'candidate').length
  if (candidates > 0) actions.push({ code: 'opportunity', count: candidates, weight: 60 })
  const openResearch = (state?.research ?? []).filter(item => item.status === 'open' || item.status === 'researching').length
  if (openResearch > 0) actions.push({ code: 'research', count: openResearch, weight: 50 })
  return actions.sort((left, right) => right.weight - left.weight).slice(0, limit)
}

/** Attach the deterministic score to every opportunity. */
export function scoredOpportunities(state) {
  return (state?.opportunities ?? []).map(opportunity => ({
    ...opportunity,
    derived: scoreOpportunity(opportunity.ratings, opportunity.compliance),
  }))
}

/** Filter, search, and sort opportunities by derived score. */
export function filterOpportunities(state, filters = {}) {
  const query = (filters.query ?? '').trim().toLowerCase()
  return scoredOpportunities(state)
    .filter(item => filters.domain === undefined || filters.domain === '' || item.domain === filters.domain)
    .filter(item => filters.status === undefined || filters.status === '' || item.status === filters.status)
    .filter(item => query === ''
      || item.title.toLowerCase().includes(query)
      || item.description.toLowerCase().includes(query)
      || item.proposer.toLowerCase().includes(query))
    .sort((left, right) => right.derived.score - left.derived.score)
}

/** Filter research by project, stage, and status. */
export function filterResearch(state, filters = {}) {
  return (state?.research ?? [])
    .filter(item => filters.projectId === undefined || filters.projectId === '' || item.projectId === filters.projectId)
    .filter(item => filters.status === undefined || filters.status === '' || item.status === filters.status)
    .filter(item => filters.stage === undefined || filters.stage === null || item.stage === filters.stage)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

/** Filter documents by project and status. */
export function filterDocs(state, filters = {}) {
  return (state?.docs ?? [])
    .filter(item => filters.projectId === undefined || filters.projectId === '' || item.projectId === filters.projectId)
    .filter(item => filters.status === undefined || filters.status === '' || item.status === filters.status)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

/** Meetings newest first. */
export function sortedMeetings(state) {
  return [...(state?.meetings ?? [])].sort((left, right) => {
    const leftKey = left.date === '' ? left.updatedAt : left.date
    const rightKey = right.date === '' ? right.updatedAt : right.date
    return rightKey.localeCompare(leftKey)
  })
}

/** Research and documents attached to one stage. */
export function stageAttachments(state, projectId, stage) {
  return {
    research: (state?.research ?? []).filter(item => item.projectId === projectId && item.stage === stage),
    docs: (state?.docs ?? []).filter(item => item.projectId === projectId && item.stage === stage),
  }
}

/** Opportunities created from one meeting. */
export function opportunitiesOfMeeting(state, meetingId) {
  return scoredOpportunities(state).filter(item => item.source.meetingId === meetingId)
}

/** The current stage title in the active language. */
export function stageTitle(locale, index) {
  const copy = stageTemplates(locale === 'en' ? 'en' : 'zh')[index]
  return copy?.title ?? `Stage ${index + 1}`
}

/** The question the current stage answers. */
export function stageQuestion(locale, index) {
  const copy = stageTemplates(locale === 'en' ? 'en' : 'zh')[index]
  return copy?.question ?? ''
}

/** Translate a dimension key to its i18n key. */
export function dimensionKey(dimension) {
  return `score.dimension.${dimension}`
}

/** The weakest dimension label key. */
export function weakestKey(derived) {
  return dimensionKey(derived.weakest)
}

/** Percent, rounded, for stage bars. */
export function percent(value, total) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

/** DIMENSIONS re-exported for the rating editor. */
export { DIMENSIONS }

/** Resolve the handoff scope from the current view. */
export function handoffScope(view) {
  if (view.projectId !== undefined && view.stage !== undefined && view.stage !== null) {
    return { kind: 'stage', id: view.projectId, stage: view.stage }
  }
  if (view.projectId !== undefined) return { kind: 'project', id: view.projectId }
  if (view.opportunityId !== undefined) return { kind: 'opportunity', id: view.opportunityId }
  if (view.meetingId !== undefined) return { kind: 'meeting', id: view.meetingId }
  if (view.researchId !== undefined) return { kind: 'research', id: view.researchId }
  if (view.docId !== undefined) return { kind: 'doc', id: view.docId }
  return { kind: 'workspace' }
}

/** Whether a selected record still exists; used after a reload. */
export function pruneView(view, state) {
  const next = { ...view }
  if (next.projectId !== undefined && !(state?.projects ?? []).some(item => item.id === next.projectId)) {
    delete next.projectId
    delete next.stage
  }
  if (next.opportunityId !== undefined && !(state?.opportunities ?? []).some(item => item.id === next.opportunityId)) delete next.opportunityId
  if (next.meetingId !== undefined && !(state?.meetings ?? []).some(item => item.id === next.meetingId)) delete next.meetingId
  if (next.researchId !== undefined && !(state?.research ?? []).some(item => item.id === next.researchId)) delete next.researchId
  if (next.docId !== undefined && !(state?.docs ?? []).some(item => item.id === next.docId)) delete next.docId
  return next
}

/** A stable project label with a fallback. */
export function projectName(state, projectId) {
  return (state?.projects ?? []).find(item => item.id === projectId)?.name ?? ''
}

/** Formats a calendar day. */
export function formatDay(value) {
  if (typeof value !== 'string' || value === '') return ''
  return value.slice(0, 10)
}
