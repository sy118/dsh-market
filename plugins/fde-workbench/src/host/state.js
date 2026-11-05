/**
 * Mutation dispatch.
 *
 * One operation object per user action. Every handler validates identifiers,
 * enums, project state, and stage editability; the derived rules (review gate,
 * decisions, return, task dependencies, document versions) live here rather
 * than in the browser.
 */
import {
  ARTIFACT_KINDS,
  ARTIFACT_STATUSES,
  COMPLIANCE_LEVELS,
  DECISION_OUTCOMES,
  DOC_STATUSES,
  DOC_TEMPLATES,
  DOMAINS,
  MAX_DOCUMENTS,
  MAX_SOURCES,
  MAX_TASKS,
  OPP_STATUSES,
  RESEARCH_STATUSES,
  SEVERITIES,
  STAGE_COUNT,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../shared/constants.js'
import { normalizeRatings } from '../shared/scoring.js'
import { stageDefinition } from '../shared/stages.js'
import { stageState } from '../shared/stage-state.js'
import { renderTemplate } from '../shared/stage-templates.js'
import { evidenceDigest } from './digest.js'
import { WorkbenchError } from './paths.js'
import {
  block,
  clampProgress,
  clampStage,
  createProject,
  createTask,
  day,
  defaultChildFile,
  documentVersionPath,
  line,
  newId,
  normalizeDoc,
  normalizeMeeting,
  normalizeOpportunity,
  normalizeResearch,
  oneOf,
  timestamp,
} from './schema.js'

const PROJECT_LABELS = {
  zh: { background: '背景', goals: '目标', scope: '范围', stakeholders: '干系人' },
  en: { background: 'Context', goals: 'Goals', scope: 'Scope', stakeholders: 'Stakeholders' },
}

/** Locale used by content the host generates at creation time. */
function localeOf(value) {
  return value === 'en' ? 'en' : 'zh'
}

/** Find one project or throw a 404. */
function projectOf(state, id) {
  const project = state.projects.find(item => item.id === id)
  if (project === undefined) throw new WorkbenchError('project/not-found', 404, `no project ${String(id)}`)
  return project
}

/** Find one collection member or throw a 404. */
function recordOf(collection, id, code) {
  const record = collection.find(item => item.id === id)
  if (record === undefined) throw new WorkbenchError(code, 404, `no record ${String(id)}`)
  return record
}

/** Refuse edits to a stage that is not current or to a closed project. */
function editableStage(project, stage) {
  if (project.status !== 'active') {
    throw new WorkbenchError('project/not-active', 409, 'only an active project accepts stage edits', {
      projectId: project.id,
      status: project.status,
    })
  }
  const index = clampStage(stage)
  if (index !== project.currentStage) {
    throw new WorkbenchError('stage/not-current', 409, 'only the current stage is editable', {
      projectId: project.id,
      currentStage: project.currentStage,
      stage: index,
    })
  }
  return index
}

/** Find a stage by index after validating it. */
function stageOf(project, stage) {
  const index = typeof stage === 'number' ? stage : Number(stage)
  if (!Number.isInteger(index) || index < 0 || index >= STAGE_COUNT) {
    throw new WorkbenchError('stage/invalid', 400, 'stage must be an integer between 0 and 7', { stage })
  }
  return { index, stage: project.stages[index] }
}

/** Validate start/end ordering. */
function validateDates(startDate, endDate) {
  if (startDate !== '' && endDate !== '' && endDate < startDate) {
    throw new WorkbenchError('project/date-order', 422, 'end date must not be before start date', {
      startDate,
      endDate,
    })
  }
}

/** Initial Markdown for a new project. */
function projectMarkdown(project) {
  const labels = PROJECT_LABELS.zh
  return `# ${project.name}\n\n## ${labels.background}\n\n${project.stakeholders}\n\n## ${labels.goals}\n\n${project.successCriteria}\n\n## ${labels.scope}\n\n## ${labels.stakeholders}\n`
}

/** Body for a new opportunity. */
function opportunityMarkdown(opportunity) {
  const description = opportunity.description.trim()
  return `# ${opportunity.title}\n\n${description === '' ? '' : `${description}\n`}`
}

/** Body for a new research note. */
function researchMarkdown(research, locale) {
  const labels = locale === 'en'
    ? { question: 'Question', findings: 'Findings' }
    : { question: '问题', findings: '结论' }
  return `# ${research.title}\n\n## ${labels.question}\n\n${research.question}\n\n## ${labels.findings}\n\n${research.conclusion}\n`
}

/** Write a file if the caller can, ignoring deletion races. */
async function writeBody(files, path, text) {
  if (path === '') return
  await files.write(path, text, null)
}

/** Delete a body if present. */
async function removeBody(files, path) {
  if (typeof path !== 'string' || path === '') return
  try {
    await files.remove(path)
  } catch {
    /* a body that is already gone needs no cleanup */
  }
}

/** Validate that a source id belongs to the project. */
function sourceOf(project, sourceId) {
  if (typeof sourceId !== 'string' || sourceId === '') return ''
  const source = project.sources.find(item => item.id === sourceId)
  if (source === undefined) {
    throw new WorkbenchError('source/not-found', 404, 'source does not belong to this project', { sourceId })
  }
  return source.id
}

/** Detect a dependency cycle in a task graph. */
function assertAcyclic(tasks, taskId, dependencyIds) {
  const graph = new Map(tasks.map(task => [task.id, task.dependencyIds]))
  graph.set(taskId, dependencyIds)
  for (const start of graph.keys()) {
    const seen = new Set()
    const stack = [start]
    while (stack.length > 0) {
      const current = stack.pop()
      if (seen.has(current)) continue
      seen.add(current)
      for (const next of graph.get(current) ?? []) {
        if (next === start) {
          throw new WorkbenchError('task/dependency-cycle', 422, 'task dependencies form a cycle', {
            taskId,
            cycleAt: start,
          })
        }
        stack.push(next)
      }
    }
  }
}

/** Validate dependency references and cycles for one task candidate. */
function validateDependencies(project, taskId, dependencyIds) {
  const ids = Array.isArray(dependencyIds) ? dependencyIds : []
  if (ids.includes(taskId)) {
    throw new WorkbenchError('task/dependency-self', 422, 'a task cannot depend on itself', { taskId })
  }
  for (const id of ids) {
    if (!project.tasks.some(task => task.id === id)) {
      throw new WorkbenchError('task/dependency-missing', 422, 'dependency must belong to the same project', {
        taskId,
        dependencyId: id,
      })
    }
  }
  assertAcyclic(project.tasks, taskId, ids)
  return [...new Set(ids)]
}

/** Whether every prerequisite is done. */
function dependenciesDone(project, task, status) {
  if (status !== 'done') return
  const open = task.dependencyIds
    .map(id => project.tasks.find(item => item.id === id))
    .filter(item => item !== undefined && item.status !== 'done')
  if (open.length > 0) {
    throw new WorkbenchError('task/dependency-open', 422, 'unfinished prerequisites block completion', {
      taskId: task.id,
      dependencyIds: open.map(item => item.id),
    })
  }
}

/** Validate task fields shared by create and update. */
function validateTaskFields(project, task, input) {
  const title = input.title === undefined ? task.title : line(input.title, 200)
  if (title === '') throw new WorkbenchError('task/title-required', 400, 'task title is required')
  const status = input.status === undefined ? task.status : oneOf(input.status, TASK_STATUSES, task.status)
  const priority = input.priority === undefined ? task.priority : oneOf(input.priority, TASK_PRIORITIES, task.priority)
  const blockedReason = input.blockedReason === undefined ? task.blockedReason : block(input.blockedReason, 1000)
  if (status === 'blocked' && blockedReason.trim() === '') {
    throw new WorkbenchError('task/blocked-reason', 422, 'a blocked task needs a reason', { taskId: task.id })
  }
  const dependencyIds = input.dependencyIds === undefined
    ? task.dependencyIds
    : validateDependencies(project, task.id, input.dependencyIds)
  const next = {
    ...task,
    title,
    status,
    priority,
    owner: input.owner === undefined ? task.owner : line(input.owner, 120),
    startDate: input.startDate === undefined ? task.startDate : day(input.startDate),
    dueDate: input.dueDate === undefined ? task.dueDate : day(input.dueDate),
    progress: input.progress === undefined ? task.progress : clampProgress(input.progress),
    dependencyIds,
    blockedReason,
    stage: input.stage === undefined ? task.stage : (input.stage === null ? null : clampStage(input.stage)),
    updatedAt: new Date().toISOString(),
  }
  validateDates(next.startDate, next.dueDate)
  dependenciesDone(project, next, next.status)
  return next
}

/** Reference scan for sources and documents. */
function references(project, kind, id) {
  const found = []
  for (let index = 0; index < project.stages.length; index += 1) {
    for (const artifact of project.stages[index].artifacts) {
      if (kind === 'source' && artifact.sourceId === id) found.push({ stage: index, evidenceId: artifact.id })
      if (kind === 'doc' && artifact.docId === id) found.push({ stage: index, evidenceId: artifact.id })
    }
  }
  return found
}

/**
 * Apply one mutation to a normalized state.
 * @param {object} state - in-memory state, mutated in place.
 * @param {object} mutation - `{ op, ...payload }`.
 * @param {object} deps - `{ files, locale }`.
 */
export async function applyMutation(state, mutation, deps) {
  if (mutation === null || typeof mutation !== 'object' || typeof mutation.op !== 'string') {
    throw new WorkbenchError('mutation/invalid', 400, 'mutation must be an object with an operation')
  }
  const { files } = deps
  const locale = localeOf(deps.locale)
  const op = mutation.op

  switch (op) {
    case 'project.create': {
      const name = line(mutation.name, 120)
      if (name === '') throw new WorkbenchError('project/name-required', 400, 'project name is required')
      const startDate = day(mutation.startDate)
      const endDate = day(mutation.endDate) || day(mutation.targetDate)
      validateDates(startDate, endDate)
      const project = createProject({ ...mutation, name, startDate, endDate }, locale)
      state.projects.unshift(project)
      await writeBody(files, project.file, projectMarkdown(project))
      return { projectId: project.id }
    }
    case 'project.update': {
      const project = projectOf(state, mutation.projectId)
      const startDate = mutation.startDate === undefined ? project.startDate : day(mutation.startDate)
      const endDate = mutation.endDate === undefined
        ? (mutation.targetDate === undefined ? project.endDate : day(mutation.targetDate))
        : day(mutation.endDate)
      validateDates(startDate, endDate)
      if (mutation.name !== undefined) {
        const name = line(mutation.name, 120)
        if (name === '') throw new WorkbenchError('project/name-required', 400, 'project name is required')
        project.name = name
      }
      if (mutation.customer !== undefined) project.customer = line(mutation.customer, 120)
      if (mutation.owner !== undefined) project.owner = line(mutation.owner, 120)
      project.startDate = startDate
      project.endDate = endDate
      project.targetDate = endDate
      if (mutation.successCriteria !== undefined) project.successCriteria = block(mutation.successCriteria, 4000)
      if (mutation.stakeholders !== undefined) project.stakeholders = block(mutation.stakeholders, 4000)
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id }
    }
    case 'project.status.set': {
      const project = projectOf(state, mutation.projectId)
      if (project.status === 'completed' || project.status === 'stopped') {
        throw new WorkbenchError('project/closed', 409, 'a completed or stopped project cannot be reopened here', {
          projectId: project.id,
          status: project.status,
        })
      }
      const status = oneOf(mutation.status, ['active', 'paused'], project.status)
      project.status = status
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id, status }
    }
    case 'project.delete': {
      const project = projectOf(state, mutation.projectId)
      const research = state.research.filter(item => item.projectId === project.id)
      const docs = state.docs.filter(item => item.projectId === project.id)
      for (const item of research) await removeBody(files, item.file)
      for (const item of docs) {
        for (const version of item.versions) await removeBody(files, version.file)
      }
      for (const stage of project.stages) await removeBody(files, stage.noteFile)
      await removeBody(files, project.file)
      state.research = state.research.filter(item => item.projectId !== project.id)
      state.docs = state.docs.filter(item => item.projectId !== project.id)
      state.projects = state.projects.filter(item => item.id !== project.id)
      return { projectId: project.id, removedProjectId: project.id, removedResearch: research.length, removedDocs: docs.length }
    }
    case 'stage.work.toggle': {
      const project = projectOf(state, mutation.projectId)
      const { stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      const work = recordOf(stage.work, mutation.workId, 'work/not-found')
      work.done = typeof mutation.done === 'boolean' ? mutation.done : !work.done
      return { projectId: project.id }
    }
    case 'stage.deliverable.write': {
      const project = projectOf(state, mutation.projectId)
      const { index, stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      const definition = stageDefinition(index).artifacts.find(item => item.id === mutation.artifactId)
      const deliverable = stage.deliverables.find(item => item.id === mutation.artifactId)
      if (definition === undefined || deliverable === undefined) {
        throw new WorkbenchError('artifact/not-found', 404, 'unknown deliverable for this stage', { artifactId: mutation.artifactId })
      }
      const content = typeof mutation.content === 'string' ? mutation.content : ''
      const path = `projects/${project.id}/${definition.path}`
      const written = await files.write(
        path,
        content,
        typeof mutation.baseHash === 'string' ? mutation.baseHash : null,
      )
      const inspected = await files.inspect(path)
      Object.assign(deliverable, {
        status: inspected.status,
        bytes: inspected.bytes,
        hash: inspected.hash,
        updatedAt: inspected.updatedAt,
        error: inspected.error,
      })
      return { projectId: project.id, path: written.path, status: inspected.status, hash: inspected.hash }
    }
    case 'stage.artifact.add': {
      const project = projectOf(state, mutation.projectId)
      const { stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      const name = line(mutation.name, 200)
      if (name === '') throw new WorkbenchError('artifact/empty', 400, 'artifact name is required')
      const sourceId = sourceOf(project, mutation.sourceId)
      const docId = typeof mutation.docId === 'string' ? mutation.docId : ''
      if (docId !== '' && !state.docs.some(item => item.id === docId)) {
        throw new WorkbenchError('doc/not-found', 404, 'document does not exist', { docId })
      }
      stage.artifacts.push({
        id: newId('a'),
        name,
        kind: oneOf(mutation.kind, ARTIFACT_KINDS, 'doc'),
        status: 'draft',
        file: '',
        sourceId,
        docId,
      })
      return { projectId: project.id, artifactId: stage.artifacts.at(-1).id }
    }
    case 'stage.artifact.cycle': {
      const project = projectOf(state, mutation.projectId)
      const { stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      const artifact = recordOf(stage.artifacts, mutation.artifactId, 'artifact/not-found')
      const index = ARTIFACT_STATUSES.indexOf(artifact.status)
      artifact.status = ARTIFACT_STATUSES[(index + 1) % ARTIFACT_STATUSES.length]
      return { projectId: project.id, status: artifact.status }
    }
    case 'stage.artifact.remove': {
      const project = projectOf(state, mutation.projectId)
      const { stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      for (const artifact of stage.artifacts) {
        if (artifact.id === mutation.artifactId) await removeBody(files, artifact.file)
      }
      stage.artifacts = stage.artifacts.filter(item => item.id !== mutation.artifactId)
      return { projectId: project.id }
    }
    case 'stage.blocker.add': {
      const project = projectOf(state, mutation.projectId)
      const { stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      const text = line(mutation.text, 300)
      if (text === '') throw new WorkbenchError('blocker/empty', 400, 'blocker text is required')
      stage.blockers.push({
        id: newId('b'),
        text,
        severity: oneOf(mutation.severity, SEVERITIES, 'medium'),
        resolved: false,
      })
      return { projectId: project.id }
    }
    case 'stage.blocker.resolve': {
      const project = projectOf(state, mutation.projectId)
      const { stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      const blocker = recordOf(stage.blockers, mutation.blockerId, 'blocker/not-found')
      blocker.resolved = typeof mutation.resolved === 'boolean' ? mutation.resolved : !blocker.resolved
      return { projectId: project.id, resolved: blocker.resolved }
    }
    case 'stage.blocker.remove': {
      const project = projectOf(state, mutation.projectId)
      const { stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      stage.blockers = stage.blockers.filter(item => item.id !== mutation.blockerId)
      return { projectId: project.id }
    }
    case 'stage.note.set': {
      const project = projectOf(state, mutation.projectId)
      const { index, stage } = stageOf(project, mutation.stage)
      editableStage(project, mutation.stage)
      const text = block(mutation.text, 100_000)
      const path = stage.noteFile === '' ? `projects/${project.id}/stages/${index}.md` : stage.noteFile
      await files.write(path, text, typeof mutation.baseHash === 'string' ? mutation.baseHash : null)
      stage.noteFile = path
      return { projectId: project.id, path }
    }
    case 'stage.decide': {
      const project = projectOf(state, mutation.projectId)
      const target = stageOf(project, mutation.stage)
      if (target.index !== project.currentStage) {
        throw new WorkbenchError('stage/not-current', 409, 'decisions can only be recorded on the current stage', {
          projectId: project.id,
          currentStage: project.currentStage,
        })
      }
      const outcome = DECISION_OUTCOMES.includes(mutation.outcome)
        ? mutation.outcome
        : mutation.action === 'revise' ? 'revise' : 'go'
      const rationale = block(mutation.rationale ?? mutation.decision, 2000).trim()
      if (rationale === '') throw new WorkbenchError('decision/empty', 400, 'decision rationale is required')
      if (project.status === 'stopped') {
        throw new WorkbenchError('project/closed', 409, 'a stopped project accepts no further decisions', {
          projectId: project.id,
        })
      }
      if (project.status === 'completed' && outcome !== 'revise' && outcome !== 'narrow') {
        throw new WorkbenchError('project/completed', 409, 'a completed project accepts revisions only', {
          projectId: project.id,
        })
      }
      if (outcome === 'go') {
        if (project.status !== 'active') {
          throw new WorkbenchError('project/not-active', 409, 'only an active project can advance', { status: project.status })
        }
        const derived = stageState(target.stage)
        if (derived.status !== 'review-ready') {
          throw new WorkbenchError('stage/not-ready', 422, 'the stage is not ready for review', {
            status: derived.status,
            blockers: derived.blockers,
          })
        }
        if (target.stage.decisions.some(item => item.outcome === 'stop' && item.legacy !== true)) {
          throw new WorkbenchError('project/stopped', 409, 'a stopped project cannot advance')
        }
      }
      const digest = evidenceDigest(target.stage.deliverables)
      const decision = {
        id: newId('s'),
        outcome,
        rationale,
        decision: rationale,
        decidedBy: line(mutation.decidedBy, 120) || project.owner,
        decidedAt: new Date().toISOString(),
        at: new Date().toISOString(),
        evidenceDigest: digest,
        fromStage: project.currentStage,
        toStage: project.currentStage,
        revision: state.revision + 1,
        legacy: false,
      }
      if (outcome === 'go') {
        if (project.currentStage === STAGE_COUNT - 1) {
          decision.toStage = STAGE_COUNT - 1
          project.status = 'completed'
          project.deliveredAt = new Date().toISOString()
          project.reconfirmThrough = null
        } else {
          project.currentStage += 1
          decision.toStage = project.currentStage
          if (project.reconfirmThrough !== null && project.currentStage > project.reconfirmThrough) {
            project.reconfirmThrough = null
          }
        }
      } else if (outcome === 'stop') {
        project.status = 'stopped'
        decision.toStage = project.currentStage
      } else {
        decision.toStage = project.currentStage
      }
      target.stage.decisions.push(decision)
      project.updatedAt = new Date().toISOString()
      return {
        projectId: project.id,
        currentStage: project.currentStage,
        deliveredAt: project.deliveredAt,
        status: project.status,
        outcome,
      }
    }
    case 'stage.return': {
      const project = projectOf(state, mutation.projectId)
      if (project.status !== 'active') {
        throw new WorkbenchError('project/not-active', 409, 'only an active project can return', { status: project.status })
      }
      if (project.currentStage <= 0) {
        throw new WorkbenchError('stage/return-first', 422, 'the first stage cannot return earlier', { projectId: project.id })
      }
      const reason = block(mutation.reason, 1000).trim()
      if (reason === '') throw new WorkbenchError('stage/return-reason', 400, 'a return reason is required')
      const from = project.currentStage
      const to = from - 1
      project.currentStage = to
      project.reconfirmThrough = Math.max(project.reconfirmThrough ?? -1, from)
      project.returns.push({
        id: newId('s'),
        from,
        to,
        reason,
        at: new Date().toISOString(),
        revision: state.revision + 1,
      })
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id, currentStage: project.currentStage, reconfirmThrough: project.reconfirmThrough }
    }
    case 'task.create': {
      const project = projectOf(state, mutation.projectId)
      if (project.tasks.length >= MAX_TASKS) throw new WorkbenchError('task/limit', 409, 'too many tasks')
      const title = line(mutation.title, 200)
      if (title === '') throw new WorkbenchError('task/title-required', 400, 'task title is required')
      const task = createTask({ ...mutation, title })
      task.dependencyIds = validateDependencies(project, task.id, mutation.dependencyIds)
      dependenciesDone(project, task, task.status)
      project.tasks.push(task)
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id, taskId: task.id }
    }
    case 'task.update': {
      const project = projectOf(state, mutation.projectId)
      const task = recordOf(project.tasks, mutation.taskId, 'task/not-found')
      const next = validateTaskFields(project, task, mutation)
      Object.assign(task, next)
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id, taskId: task.id }
    }
    case 'task.delete': {
      const project = projectOf(state, mutation.projectId)
      const task = recordOf(project.tasks, mutation.taskId, 'task/not-found')
      project.tasks = project.tasks.filter(item => item.id !== task.id)
      for (const item of project.tasks) item.dependencyIds = item.dependencyIds.filter(id => id !== task.id)
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id, taskId: task.id }
    }
    case 'source.add': {
      const project = projectOf(state, mutation.projectId)
      if (project.sources.length >= MAX_SOURCES) throw new WorkbenchError('source/limit', 409, 'too many sources')
      const source = {
        id: typeof mutation.sourceId === 'string' && mutation.sourceId !== '' ? mutation.sourceId : newId('f'),
        name: line(mutation.name, 200),
        mime: line(mutation.mime, 120) || 'application/octet-stream',
        bytes: Number.isInteger(mutation.bytes) ? mutation.bytes : 0,
        sha256: typeof mutation.sha256 === 'string' ? mutation.sha256 : '',
        version: Number.isInteger(mutation.version) ? mutation.version : 1,
        path: typeof mutation.path === 'string' ? mutation.path : '',
        createdAt: new Date().toISOString(),
        replacedAt: null,
      }
      if (source.name === '' || source.path === '') throw new WorkbenchError('source/invalid', 400, 'source name and path are required')
      if (!source.path.startsWith(`projects/${project.id}/sources/${source.id}/`)) {
        throw new WorkbenchError('source/invalid-path', 400, 'source path must stay in the project source directory', {
          path: source.path,
        })
      }
      const existing = project.sources.find(item => item.id === source.id)
      if (existing === undefined) project.sources.push(source)
      else {
        Object.assign(existing, source, {
          version: Number.isInteger(mutation.version) && mutation.version > existing.version
            ? mutation.version
            : existing.version + 1,
          replacedAt: new Date().toISOString(),
        })
      }
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id, sourceId: source.id }
    }
    case 'source.delete': {
      const project = projectOf(state, mutation.projectId)
      const source = recordOf(project.sources, mutation.sourceId, 'source/not-found')
      const used = references(project, 'source', source.id)
      if (used.length > 0) {
        throw new WorkbenchError('source/referenced', 409, 'source is referenced by stage evidence', {
          sourceId: source.id,
          references: used,
        })
      }
      project.sources = project.sources.filter(item => item.id !== source.id)
      await files.removeDir(`projects/${project.id}/sources/${source.id}`)
      project.updatedAt = new Date().toISOString()
      return { projectId: project.id, sourceId: source.id }
    }
    case 'opportunity.create': {
      const title = line(mutation.title, 200)
      if (title === '') throw new WorkbenchError('opportunity/title-required', 400, 'opportunity title is required')
      const opportunity = normalizeOpportunity({
        id: newId('o'),
        title,
        description: block(mutation.description, 5000),
        proposer: line(mutation.proposer, 120),
        domain: oneOf(mutation.domain, DOMAINS, 'other'),
        taskType: oneOf(mutation.taskType, TASK_TYPES, 'validate'),
        source: mutation.source !== null && typeof mutation.source === 'object' ? mutation.source : { type: 'idea' },
        ratings: normalizeRatings(mutation.ratings),
        compliance: oneOf(mutation.compliance, COMPLIANCE_LEVELS, 'medium'),
        status: oneOf(mutation.status, OPP_STATUSES, 'candidate'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      state.opportunities.unshift(opportunity)
      await writeBody(files, opportunity.file, opportunityMarkdown(opportunity))
      return { opportunityId: opportunity.id }
    }
    case 'opportunity.update': {
      const opportunity = recordOf(state.opportunities, mutation.opportunityId, 'opportunity/not-found')
      if (mutation.title !== undefined) {
        const title = line(mutation.title, 200)
        if (title === '') throw new WorkbenchError('opportunity/title-required', 400, 'opportunity title is required')
        opportunity.title = title
      }
      if (mutation.description !== undefined) opportunity.description = block(mutation.description, 5000)
      if (mutation.proposer !== undefined) opportunity.proposer = line(mutation.proposer, 120)
      if (mutation.domain !== undefined) opportunity.domain = oneOf(mutation.domain, DOMAINS, opportunity.domain)
      if (mutation.taskType !== undefined) {
        opportunity.taskType = oneOf(mutation.taskType, TASK_TYPES, opportunity.taskType)
      }
      if (mutation.status !== undefined) opportunity.status = oneOf(mutation.status, OPP_STATUSES, opportunity.status)
      if (mutation.compliance !== undefined) {
        opportunity.compliance = oneOf(mutation.compliance, COMPLIANCE_LEVELS, opportunity.compliance)
      }
      if (mutation.ratings !== undefined) opportunity.ratings = normalizeRatings(mutation.ratings)
      opportunity.updatedAt = new Date().toISOString()
      return { opportunityId: opportunity.id }
    }
    case 'opportunity.delete': {
      const opportunity = recordOf(state.opportunities, mutation.opportunityId, 'opportunity/not-found')
      await removeBody(files, opportunity.file)
      state.opportunities = state.opportunities.filter(item => item.id !== opportunity.id)
      return { opportunityId: opportunity.id }
    }
    case 'meeting.create': {
      const title = line(mutation.title, 200)
      if (title === '') throw new WorkbenchError('meeting/title-required', 400, 'meeting title is required')
      const meeting = normalizeMeeting({
        id: newId('m'),
        title,
        date: day(mutation.date) || new Date().toISOString().slice(0, 10),
        attendees: mutation.attendees,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      state.meetings.unshift(meeting)
      await writeBody(files, meeting.file, `# ${meeting.title}\n\n${block(mutation.content, 100_000)}`)
      return { meetingId: meeting.id }
    }
    case 'meeting.update': {
      const meeting = recordOf(state.meetings, mutation.meetingId, 'meeting/not-found')
      if (mutation.title !== undefined) {
        const title = line(mutation.title, 200)
        if (title === '') throw new WorkbenchError('meeting/title-required', 400, 'meeting title is required')
        meeting.title = title
      }
      if (mutation.date !== undefined) meeting.date = day(mutation.date)
      if (mutation.attendees !== undefined) {
        meeting.attendees = (Array.isArray(mutation.attendees) ? mutation.attendees : [])
          .filter(item => typeof item === 'string')
          .map(item => line(item, 120))
          .filter(Boolean)
          .slice(0, 40)
      }
      if (mutation.content !== undefined) {
        await files.write(meeting.file, block(mutation.content, 100_000), null)
      }
      meeting.updatedAt = new Date().toISOString()
      return { meetingId: meeting.id }
    }
    case 'meeting.delete': {
      const meeting = recordOf(state.meetings, mutation.meetingId, 'meeting/not-found')
      await removeBody(files, meeting.file)
      state.meetings = state.meetings.filter(item => item.id !== meeting.id)
      return { meetingId: meeting.id }
    }
    case 'research.create': {
      const title = line(mutation.title, 200)
      if (title === '') throw new WorkbenchError('research/title-required', 400, 'research title is required')
      const projectId = typeof mutation.projectId === 'string' ? mutation.projectId : ''
      if (projectId !== '') projectOf(state, projectId)
      const research = normalizeResearch({
        id: newId('r'),
        title,
        projectId,
        stage: mutation.stage,
        status: oneOf(mutation.status, RESEARCH_STATUSES, 'open'),
        question: block(mutation.question, 5000),
        conclusion: block(mutation.conclusion, 20_000),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      research.file = defaultChildFile('research', projectId, research.id)
      state.research.unshift(research)
      await writeBody(files, research.file, researchMarkdown(research, locale))
      return { researchId: research.id }
    }
    case 'research.update': {
      const research = recordOf(state.research, mutation.researchId, 'research/not-found')
      if (mutation.title !== undefined) {
        const title = line(mutation.title, 200)
        if (title === '') throw new WorkbenchError('research/title-required', 400, 'research title is required')
        research.title = title
      }
      if (mutation.status !== undefined) {
        research.status = oneOf(mutation.status, RESEARCH_STATUSES, research.status)
      }
      if (mutation.question !== undefined) research.question = block(mutation.question, 5000)
      if (mutation.conclusion !== undefined) research.conclusion = block(mutation.conclusion, 20_000)
      if (mutation.projectId !== undefined) {
        const projectId = typeof mutation.projectId === 'string' ? mutation.projectId : ''
        if (projectId !== '') projectOf(state, projectId)
        research.projectId = projectId
      }
      if (mutation.stage !== undefined) {
        research.stage = mutation.stage === null ? null : clampStage(mutation.stage)
      }
      research.updatedAt = new Date().toISOString()
      return { researchId: research.id }
    }
    case 'research.delete': {
      const research = recordOf(state.research, mutation.researchId, 'research/not-found')
      await removeBody(files, research.file)
      state.research = state.research.filter(item => item.id !== research.id)
      return { researchId: research.id }
    }
    case 'doc.create': {
      const title = line(mutation.title, 200)
      if (title === '') throw new WorkbenchError('doc/title-required', 400, 'document title is required')
      const projectId = typeof mutation.projectId === 'string' ? mutation.projectId : ''
      const project = projectId === '' ? undefined : projectOf(state, projectId)
      const template = oneOf(mutation.template, DOC_TEMPLATES, 'delivery')
      const id = newId('d')
      const file = documentVersionPath(projectId, id, 1)
      const now = new Date().toISOString()
      const doc = normalizeDoc({
        id,
        title,
        template,
        projectId,
        stage: mutation.stage,
        status: 'draft',
        file,
        currentVersion: 1,
        versions: [{ version: 1, file, createdAt: now, source: 'create' }],
        createdAt: now,
        updatedAt: now,
      })
      state.docs.unshift(doc)
      const projectName = project?.name ?? title
      await writeBody(files, file, renderTemplate(template, locale, projectName, now.slice(0, 10)))
      return { docId: doc.id, projectId, version: 1 }
    }
    case 'doc.update': {
      const doc = recordOf(state.docs, mutation.docId, 'doc/not-found')
      if (doc.status === 'archived') {
        throw new WorkbenchError('doc/archived', 409, 'an archived document is read-only', { docId: doc.id })
      }
      if (mutation.title !== undefined) {
        const title = line(mutation.title, 200)
        if (title === '') throw new WorkbenchError('doc/title-required', 400, 'document title is required')
        doc.title = title
      }
      if (mutation.status !== undefined) doc.status = oneOf(mutation.status, DOC_STATUSES, doc.status)
      if (mutation.template !== undefined) doc.template = oneOf(mutation.template, DOC_TEMPLATES, doc.template)
      if (mutation.projectId !== undefined) {
        const projectId = typeof mutation.projectId === 'string' ? mutation.projectId : ''
        if (projectId !== '') projectOf(state, projectId)
        doc.projectId = projectId
      }
      if (mutation.stage !== undefined) doc.stage = mutation.stage === null ? null : clampStage(mutation.stage)
      doc.updatedAt = new Date().toISOString()
      return { docId: doc.id, projectId: doc.projectId }
    }
    case 'doc.save': {
      const doc = recordOf(state.docs, mutation.docId, 'doc/not-found')
      if (doc.status === 'archived') {
        throw new WorkbenchError('doc/archived', 409, 'an archived document is read-only', { docId: doc.id })
      }
      const content = typeof mutation.content === 'string' ? mutation.content : ''
      const version = doc.currentVersion + 1
      const file = documentVersionPath(doc.projectId, doc.id, version)
      await files.write(file, content, null)
      doc.versions.push({ version, file, createdAt: new Date().toISOString(), source: 'save' })
      doc.currentVersion = version
      doc.file = file
      doc.updatedAt = new Date().toISOString()
      return { docId: doc.id, projectId: doc.projectId, version, hash: (await files.read(file)).hash }
    }
    case 'doc.restore': {
      const doc = recordOf(state.docs, mutation.docId, 'doc/not-found')
      if (doc.status === 'archived') {
        throw new WorkbenchError('doc/archived', 409, 'an archived document is read-only', { docId: doc.id })
      }
      const source = doc.versions.find(item => item.version === Number(mutation.version))
      if (source === undefined) throw new WorkbenchError('doc/version-not-found', 404, 'document version does not exist')
      const text = (await files.read(source.file)).text
      const version = doc.currentVersion + 1
      const file = documentVersionPath(doc.projectId, doc.id, version)
      await files.write(file, text, null)
      doc.versions.push({ version, file, createdAt: new Date().toISOString(), source: 'restore' })
      doc.currentVersion = version
      doc.file = file
      doc.updatedAt = new Date().toISOString()
      return { docId: doc.id, projectId: doc.projectId, version, restoredFrom: source.version }
    }
    case 'doc.delete': {
      const doc = recordOf(state.docs, mutation.docId, 'doc/not-found')
      const used = state.projects.flatMap(project => references(project, 'doc', doc.id).map(ref => ({ projectId: project.id, ...ref })))
      if (used.length > 0) {
        throw new WorkbenchError('doc/referenced', 409, 'document is referenced by stage evidence', {
          docId: doc.id,
          references: used,
        })
      }
      for (const version of doc.versions) await removeBody(files, version.file)
      state.docs = state.docs.filter(item => item.id !== doc.id)
      return { docId: doc.id, projectId: doc.projectId }
    }
    default:
      throw new WorkbenchError('mutation/unknown', 400, `unknown operation ${op}`)
  }
}
