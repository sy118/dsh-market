/**
 * Render the selected records into the model's context.
 *
 * The browser sends ids, never whole records: the host re-reads the state and
 * the relevant bodies so an agent edit made a second ago is what the model
 * sees. Context is capped by bytes and each section is bounded.
 */
import { STAGE_COUNT } from '../../shared/constants.js'
import { scoreOpportunity } from '../../shared/scoring.js'
import { stageTemplates } from '../../shared/stage-templates.js'
import { WorkbenchError } from '../paths.js'

/** Byte-aware truncation with an explicit marker. */
export function trimToBytes(text, limit) {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= limit) return { text, truncated: false }
  const buffer = Buffer.from(text, 'utf8').subarray(0, Math.max(0, limit - 64))
  const body = buffer.toString('utf8').replace(/\uFFFD+$/u, '')
  return { text: `${body}\n\n[context truncated to fit the request limit]`, truncated: true }
}

/** Read one body, returning an empty string when it does not exist. */
async function readBody(files, path, limit = 12_000) {
  if (typeof path !== 'string' || path === '') return ''
  try {
    const { text } = await files.read(path)
    return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text
  } catch (error) {
    if (error.code === 'file/not-found') return ''
    throw error
  }
}

/** Find a record or throw a 404. */
function find(collection, id, code) {
  const record = collection.find(item => item.id === id)
  if (record === undefined) throw new WorkbenchError(code, 404, `no record ${String(id)}`)
  return record
}

/** Compact project facts without the eight stages. */
function projectFacts(project) {
  return {
    id: project.id,
    name: project.name,
    customer: project.customer,
    owner: project.owner,
    startDate: project.startDate,
    endDate: project.endDate,
    status: project.status,
    successCriteria: project.successCriteria,
    stakeholders: project.stakeholders,
    currentStage: project.currentStage,
    deliveredAt: project.deliveredAt,
    file: project.file,
  }
}

/** Compact stage facts plus its localized title. */
function stageFacts(project, index, locale) {
  const stage = project.stages[index]
  const copy = stageTemplates(locale)[index]
  return {
    index,
    title: copy.title,
    question: copy.question,
    status: stage.status,
    work: stage.work,
    deliverables: stage.deliverables,
    artifacts: stage.artifacts,
    blockers: stage.blockers,
    decisions: stage.decisions,
    reviewBlockers: stage.reviewBlockers,
    noteFile: stage.noteFile,
    editable: index === project.currentStage && project.status === 'active',
  }
}

/** Render one titled block of JSON. */
function section(title, value) {
  return `## ${title}\n${JSON.stringify(value, null, 2)}`
}

/** Render a project and one stage. */
function projectStageSection(project, index, locale, files) {
  const stage = project.stages[index]
  const parts = [section('project', projectFacts(project)), section(`stage ${index}`, stageFacts(project, index, locale))]
  const artifacts = (stage.deliverables ?? [])
    .filter(item => item.status === 'present')
    .map(item => `projects/${project.id}/${item.path}`)
  return { parts, files: [project.file, stage.noteFile, ...artifacts].filter(Boolean) }
}

/** Build the context for one task. */
export async function buildContext(task, payload, options) {
  const { state, files, locale } = options
  const parts = []
  const referenced = []
  const push = (title, value) => parts.push(section(title, value))

  if (task === 'opportunity.assess') {
    const opportunity = find(state.opportunities, payload.opportunityId, 'opportunity/not-found')
    const derived = scoreOpportunity(opportunity.ratings, opportunity.compliance)
    push('opportunity', { ...opportunity, derived })
    referenced.push(opportunity.file)
    if (opportunity.source.meetingId !== '') {
      const meeting = state.meetings.find(item => item.id === opportunity.source.meetingId)
      if (meeting !== undefined) {
        push('source meeting', { ...meeting, minutes: await readBody(files, meeting.file) })
        referenced.push(meeting.file)
      }
    }
  } else if (task === 'meeting.extract') {
    const meeting = find(state.meetings, payload.meetingId, 'meeting/not-found')
    push('meeting', { ...meeting, minutes: await readBody(files, meeting.file, 20_000) })
    referenced.push(meeting.file)
  } else if (task === 'research.synthesize') {
    const research = find(state.research, payload.researchId, 'research/not-found')
    push('research', { ...research, body: await readBody(files, research.file) })
    referenced.push(research.file)
    const project = state.projects.find(item => item.id === research.projectId)
    if (project !== undefined) {
      const index = research.stage ?? project.currentStage
      const context = projectStageSection(project, index, locale, files)
      parts.push(...context.parts)
      referenced.push(...context.files)
    }
  } else if (task === 'doc.draft') {
    const project = payload.projectId === undefined
      ? undefined
      : find(state.projects, payload.projectId, 'project/not-found')
    if (project !== undefined) {
      const index = payload.stage === undefined || payload.stage === null ? project.currentStage : Number(payload.stage)
      const context = projectStageSection(project, Math.min(STAGE_COUNT - 1, Math.max(0, index)), locale, files)
      parts.push(...context.parts)
      referenced.push(...context.files)
      push('research', state.research.filter(item => item.projectId === project.id).map(item => ({
        id: item.id,
        title: item.title,
        status: item.status,
        conclusion: item.conclusion.slice(0, 2000),
        file: item.file,
      })))
      push('documents', state.docs.filter(item => item.projectId === project.id).map(item => ({
        id: item.id,
        title: item.title,
        status: item.status,
        template: item.template,
        file: item.file,
      })))
    }
    push('request', {
      title: payload.title ?? '交付文档',
      template: payload.template ?? 'delivery',
      targetHeading: payload.title ?? '',
    })
  } else if (task === 'stage.review') {
    const project = find(state.projects, payload.projectId, 'project/not-found')
    const index = Number(payload.stage ?? project.currentStage)
    if (!Number.isInteger(index) || index < 0 || index >= STAGE_COUNT) {
      throw new WorkbenchError('stage/invalid', 400, 'stage must be an integer between 0 and 7')
    }
    const context = projectStageSection(project, index, locale, files)
    parts.push(...context.parts)
    referenced.push(...context.files)
    const note = await readBody(files, project.stages[index].noteFile)
    if (note !== '') parts.push(`## stage note\n${note}`)
  } else if (task === 'assistant.chat' || task === 'assistant.command') {
    const scope = payload.scope !== null && typeof payload.scope === 'object' ? payload.scope : { kind: 'workspace' }
    if (scope.kind === 'project' && typeof scope.id === 'string') {
      const project = find(state.projects, scope.id, 'project/not-found')
      const index = scope.stage === undefined ? project.currentStage : Number(scope.stage)
      const context = projectStageSection(project, Math.min(STAGE_COUNT - 1, Math.max(0, index)), locale, files)
      parts.push(...context.parts)
      referenced.push(...context.files)
    } else if (scope.kind === 'opportunity' && typeof scope.id === 'string') {
      const opportunity = find(state.opportunities, scope.id, 'opportunity/not-found')
      push('opportunity', opportunity)
      referenced.push(opportunity.file)
    } else if (scope.kind === 'meeting' && typeof scope.id === 'string') {
      const meeting = find(state.meetings, scope.id, 'meeting/not-found')
      push('meeting', { ...meeting, minutes: await readBody(files, meeting.file) })
      referenced.push(meeting.file)
    } else if (scope.kind === 'research' && typeof scope.id === 'string') {
      const research = find(state.research, scope.id, 'research/not-found')
      push('research', { ...research, body: await readBody(files, research.file) })
      referenced.push(research.file)
    } else if (scope.kind === 'doc' && typeof scope.id === 'string') {
      const doc = find(state.docs, scope.id, 'doc/not-found')
      push('document', { ...doc, body: await readBody(files, doc.file) })
      referenced.push(doc.file)
    } else {
      push('workspace', {
        rootFiles: ['workbench.json', 'AGENTS.md'],
        projects: state.projects.map(item => ({ id: item.id, name: item.name, currentStage: item.currentStage })),
        opportunities: state.opportunities.length,
        meetings: state.meetings.length,
        research: state.research.length,
        docs: state.docs.length,
      })
    }
    const messages = Array.isArray(payload.messages) ? payload.messages.slice(-8) : []
    const history = messages
      .filter(item => item !== null && typeof item === 'object' && typeof item.text === 'string')
      .map(item => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.text.slice(0, 3000)}`)
      .join('\n\n')
    if (history !== '') parts.push(`## conversation so far\n${history}`)
  } else {
    throw new WorkbenchError('ai/task', 400, `unknown AI task ${String(task)}`)
  }

  return {
    contextText: parts.join('\n\n'),
    files: [...new Set(referenced.filter(Boolean))],
    truncated: false,
  }
}

/** Build and cap context for one request. */
export async function buildCappedContext(task, payload, options) {
  const built = await buildContext(task, payload, options)
  const capped = trimToBytes(built.contextText, options.limit)
  return { ...built, contextText: capped.text, truncated: capped.truncated }
}

/** Read the files referenced by a context, for diagnostics. */
export async function readReferenced(files, paths) {
  const out = {}
  for (const path of paths) {
    out[path] = await readBody(files, path)
  }
  return out
}
