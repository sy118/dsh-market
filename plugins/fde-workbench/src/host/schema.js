/**
 * Record shapes, defaults, and normalization.
 *
 * The browser and an agent may both edit workbench files, so every load is
 * normalized: unknown fields are dropped, enums fall back to their first
 * value, missing ids are minted, and the eight stage contracts are always
 * present. Deliverable status is recomputed by the store from disk.
 */
import { randomBytes } from 'node:crypto'
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
import { normalizeRatings } from '../shared/scoring.js'
import { STAGES, stageDefinition } from '../shared/stages.js'
import { stageTemplates } from '../shared/stage-templates.js'
import { WorkbenchError } from './paths.js'

const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/** Mint one short, path-safe record id. */
export function newId(prefix) {
  const bytes = randomBytes(6)
  let out = ''
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length]
  return `${prefix}-${out}`
}

/** Plain-object test. */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Trimmed single-line text. */
export function line(value, max = 200) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Multi-line text with a length cap. */
export function block(value, max = 20_000) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').slice(0, max)
}

/** One enum member or the declared fallback. */
export function oneOf(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

/** Boolean with a fallback. */
export function boolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

/** ISO timestamp, else the fallback. */
export function timestamp(value, fallback = new Date().toISOString()) {
  if (typeof value !== 'string') return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
}

/** `YYYY-MM-DD`, or the empty string. */
export function day(value) {
  if (typeof value !== 'string') return ''
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

/** Clamp a stage index into 0–7. */
export function clampStage(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(STAGE_COUNT - 1, Math.max(0, Math.trunc(number)))
}

/** Clamp a progress percentage. */
export function clampProgress(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(100, Math.max(0, Math.round(number)))
}

/** Array of strings, capped. */
function stringList(value, max = 40) {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string').map(item => line(item, 120)).filter(Boolean).slice(0, max)
}

/** Unique path-safe ids. */
function idList(value, max = MAX_TASKS) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(item => typeof item === 'string' && item !== '').slice(0, max))]
}

/** Empty state before anything was saved. */
export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: new Date().toISOString(),
    migration: { legacyImportedAt: null, legacySchema: null, v2MigratedAt: null },
    projects: [],
    opportunities: [],
    meetings: [],
    research: [],
    docs: [],
  }
}

/** Deliverable skeleton for one stage definition. */
export function createDeliverables(index, locale = 'zh') {
  const lang = locale === 'en' ? 'en' : 'zh'
  return stageDefinition(index).artifacts.map(artifact => ({
    id: artifact.id,
    title: artifact.title[lang],
    path: artifact.path,
    required: artifact.required,
    status: 'missing',
    bytes: 0,
    hash: '',
    updatedAt: null,
    error: null,
  }))
}

/** One fresh stage with four fixed work items and its fixed artifacts. */
export function createStage(indexOrTemplate, locale = 'zh') {
  const index = typeof indexOrTemplate === 'number'
    ? clampStage(indexOrTemplate)
    : Math.max(0, STAGES.findIndex(stage => stage.id === indexOrTemplate?.id))
  const definition = stageDefinition(index)
  const lang = locale === 'en' ? 'en' : 'zh'
  return {
    id: definition.id,
    work: definition.work.map(item => ({ id: newId('w'), text: item.text[lang], done: false })),
    deliverables: createDeliverables(index, lang),
    artifacts: [],
    blockers: [],
    decisions: [],
    noteFile: '',
  }
}

/** Create the eight stages for a new project. */
export function createStages(locale = 'zh') {
  return Array.from({ length: STAGE_COUNT }, (_, index) => createStage(index, locale))
}

/** One fresh task. */
export function createTask(input, now = new Date().toISOString()) {
  return normalizeTask({
    id: newId('t'),
    title: input.title,
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    owner: input.owner,
    startDate: input.startDate,
    dueDate: input.dueDate,
    progress: input.progress,
    dependencyIds: input.dependencyIds,
    blockedReason: input.blockedReason,
    stage: input.stage,
    createdAt: now,
    updatedAt: now,
  })
}

/** Create one project record. */
export function createProject(input, locale = 'zh') {
  const id = newId('p')
  const now = new Date().toISOString()
  const stages = createStages(locale)
  stages.forEach((stage, index) => {
    stage.noteFile = `projects/${id}/stages/${index}.md`
  })
  const endDate = day(input.endDate) || day(input.targetDate)
  return {
    id,
    name: line(input.name, 120),
    customer: line(input.customer, 120),
    owner: line(input.owner, 120),
    startDate: day(input.startDate),
    endDate,
    targetDate: endDate,
    status: 'active',
    successCriteria: block(input.successCriteria, 4000),
    stakeholders: block(input.stakeholders, 4000),
    createdAt: now,
    updatedAt: now,
    currentStage: 0,
    deliveredAt: null,
    reconfirmThrough: null,
    returns: [],
    tasks: [],
    sources: [],
    file: `projects/${id}/project.md`,
    stages,
  }
}

/** Normalize one work item. */
function normalizeWork(raw) {
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : newId('w'),
    text: line(raw.text, 300),
    done: boolean(raw.done),
  }
}

/** Normalize one evidence item. */
function normalizeArtifact(raw) {
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : newId('a'),
    name: line(raw.name, 200),
    kind: oneOf(raw.kind, ARTIFACT_KINDS, 'doc'),
    status: oneOf(raw.status, ARTIFACT_STATUSES, 'draft'),
    file: typeof raw.file === 'string' ? raw.file : '',
    sourceId: typeof raw.sourceId === 'string' ? raw.sourceId : '',
    docId: typeof raw.docId === 'string' ? raw.docId : '',
  }
}

/** Normalize one blocker. */
function normalizeBlocker(raw) {
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : newId('b'),
    text: line(raw.text, 300),
    severity: oneOf(raw.severity, SEVERITIES, 'medium'),
    resolved: boolean(raw.resolved),
  }
}

/** Normalize one decision, including legacy advance/revise records. */
function normalizeDecision(raw, stageIndex = 0) {
  const source = isRecord(raw) ? raw : {}
  const legacy = source.legacy === true || (source.kind !== undefined && source.outcome === undefined)
  const outcome = DECISION_OUTCOMES.includes(source.outcome)
    ? source.outcome
    : source.kind === 'revise' ? 'revise' : 'go'
  const rationale = block(source.rationale ?? source.decision, 2000)
  const decidedAt = timestamp(source.decidedAt ?? source.at)
  const toStage = Number.isInteger(source.toStage) ? source.toStage : (outcome === 'go' ? stageIndex + 1 : stageIndex)
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : newId('s'),
    outcome,
    rationale,
    decision: rationale,
    decidedBy: line(source.decidedBy, 120),
    decidedAt,
    at: decidedAt,
    evidenceDigest: typeof source.evidenceDigest === 'string' ? source.evidenceDigest : '',
    fromStage: Number.isInteger(source.fromStage) ? source.fromStage : stageIndex,
    toStage,
    revision: Number.isInteger(source.revision) ? source.revision : 0,
    legacy,
  }
}

/** Normalize one return record. */
function normalizeReturn(raw) {
  const source = isRecord(raw) ? raw : {}
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : newId('s'),
    from: clampStage(source.from),
    to: clampStage(source.to),
    reason: block(source.reason, 1000),
    at: timestamp(source.at),
    revision: Number.isInteger(source.revision) ? source.revision : 0,
  }
}

/** Normalize one deliverable, keeping its computed status when present. */
function normalizeDeliverable(raw, fallback) {
  const source = isRecord(raw) ? raw : {}
  return {
    id: source.id ?? fallback.id,
    title: line(source.title, 120) || fallback.title,
    path: typeof source.path === 'string' && source.path !== '' ? source.path : fallback.path,
    required: typeof source.required === 'boolean' ? source.required : fallback.required,
    status: ['present', 'missing', 'error'].includes(source.status) ? source.status : 'missing',
    bytes: Number.isInteger(source.bytes) && source.bytes >= 0 ? source.bytes : 0,
    hash: typeof source.hash === 'string' ? source.hash : '',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    error: typeof source.error === 'string' ? source.error : null,
  }
}

/** Merge fixed deliverables with any persisted status. */
function normalizeDeliverables(source, index, locale) {
  const fallback = createDeliverables(index, locale)
  const raw = (Array.isArray(source) ? source : []).filter(isRecord)
  return fallback.map(item => normalizeDeliverable(raw.find(entry => entry.id === item.id), item))
}

/** Normalize one stage, forcing exactly four work items. */
function normalizeStage(raw, index, locale) {
  const source = isRecord(raw) ? raw : {}
  const lang = locale === 'en' ? 'en' : 'zh'
  const definition = stageDefinition(index)
  const existingWork = (Array.isArray(source.work) ? source.work : []).filter(isRecord).map(normalizeWork)
  const work = definition.work.map((item, position) => {
    const found = existingWork[position]
    return found === undefined
      ? { id: newId('w'), text: item.text[lang], done: false }
      : { ...found, text: found.text === '' ? item.text[lang] : found.text }
  })
  return {
    id: definition.id,
    work,
    deliverables: normalizeDeliverables(source.deliverables, index, locale),
    artifacts: (Array.isArray(source.artifacts) ? source.artifacts : []).filter(isRecord).map(normalizeArtifact).slice(0, 100),
    blockers: (Array.isArray(source.blockers) ? source.blockers : []).filter(isRecord).map(normalizeBlocker).slice(0, 100),
    decisions: (Array.isArray(source.decisions) ? source.decisions : []).filter(isRecord).map(item => normalizeDecision(item, index)).slice(0, 200),
    noteFile: typeof source.noteFile === 'string' ? source.noteFile : '',
  }
}

/** Normalize one task. */
export function normalizeTask(raw) {
  const source = isRecord(raw) ? raw : {}
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : newId('t'),
    title: line(source.title, 200),
    status: oneOf(source.status, TASK_STATUSES, 'todo'),
    priority: oneOf(source.priority, TASK_PRIORITIES, 'medium'),
    owner: line(source.owner, 120),
    startDate: day(source.startDate),
    dueDate: day(source.dueDate),
    progress: clampProgress(source.progress),
    dependencyIds: idList(source.dependencyIds),
    blockedReason: block(source.blockedReason, 1000),
    stage: source.stage === null || source.stage === undefined ? null : clampStage(source.stage),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
  }
}

/** Normalize one source record. */
export function normalizeSource(raw) {
  const source = isRecord(raw) ? raw : {}
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : newId('f'),
    name: line(source.name, 200),
    mime: line(source.mime, 120) || 'application/octet-stream',
    bytes: Number.isInteger(source.bytes) && source.bytes >= 0 ? source.bytes : 0,
    sha256: typeof source.sha256 === 'string' ? source.sha256 : '',
    version: Number.isInteger(source.version) && source.version >= 1 ? source.version : 1,
    path: typeof source.path === 'string' ? source.path : '',
    createdAt: timestamp(source.createdAt),
    replacedAt: typeof source.replacedAt === 'string' ? source.replacedAt : null,
  }
}

/** Normalize one document version. */
function normalizeVersion(raw, fallbackVersion) {
  const source = isRecord(raw) ? raw : {}
  return {
    version: Number.isInteger(source.version) && source.version >= 1 ? source.version : fallbackVersion,
    file: typeof source.file === 'string' ? source.file : '',
    createdAt: timestamp(source.createdAt),
    source: ['create', 'save', 'restore'].includes(source.source) ? source.source : 'save',
  }
}

/** Normalize one project, keeping exactly eight stage contracts. */
export function normalizeProject(raw, locale = 'zh') {
  const source = isRecord(raw) ? raw : {}
  const id = typeof source.id === 'string' && source.id !== '' ? source.id : newId('p')
  const stagesInput = Array.isArray(source.stages) ? source.stages : []
  const stages = []
  for (let index = 0; index < STAGE_COUNT; index += 1) {
    const stage = normalizeStage(stagesInput[index], index, locale)
    if (stage.noteFile === '') stage.noteFile = `projects/${id}/stages/${index}.md`
    stages.push(stage)
  }
  const endDate = day(source.endDate) || day(source.targetDate)
  const deliveredAt = typeof source.deliveredAt === 'string' ? timestamp(source.deliveredAt, '') || null : null
  const status = PROJECT_STATUSES.includes(source.status)
    ? source.status
    : deliveredAt !== null ? 'completed' : 'active'
  const reconfirm = Number.isInteger(source.reconfirmThrough) ? clampStage(source.reconfirmThrough) : null
  return {
    id,
    name: line(source.name, 120),
    customer: line(source.customer, 120),
    owner: line(source.owner, 120),
    startDate: day(source.startDate),
    endDate,
    targetDate: endDate,
    status,
    successCriteria: block(source.successCriteria, 4000),
    stakeholders: block(source.stakeholders, 4000),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
    currentStage: clampStage(source.currentStage),
    deliveredAt,
    reconfirmThrough: reconfirm !== null && reconfirm >= 0 && reconfirm < STAGE_COUNT ? reconfirm : null,
    returns: (Array.isArray(source.returns) ? source.returns : []).filter(isRecord).map(normalizeReturn).slice(0, 50),
    tasks: (Array.isArray(source.tasks) ? source.tasks : []).filter(isRecord).map(normalizeTask).slice(0, MAX_TASKS),
    sources: (Array.isArray(source.sources) ? source.sources : []).filter(isRecord).map(normalizeSource).slice(0, MAX_SOURCES),
    file: typeof source.file === 'string' && source.file !== '' ? source.file : `projects/${id}/project.md`,
    stages,
  }
}

/** Normalize one AI assessment attached to an opportunity. */
function normalizeAi(raw) {
  if (!isRecord(raw)) return null
  return {
    provider: line(raw.provider, 80),
    model: line(raw.model, 120),
    at: timestamp(raw.at),
    rationale: block(raw.rationale, 4000),
    conditions: stringList(raw.conditions, 20),
    suggested: isRecord(raw.suggested) ? normalizeRatings(raw.suggested.ratings ?? raw.suggested) : null,
  }
}

/** Normalize one opportunity. */
export function normalizeOpportunity(raw) {
  const source = isRecord(raw) ? raw : {}
  const id = typeof source.id === 'string' && source.id !== '' ? source.id : newId('o')
  const sourceInput = isRecord(source.source) ? source.source : {}
  return {
    id,
    title: line(source.title, 200),
    description: block(source.description, 5000),
    proposer: line(source.proposer, 120),
    domain: oneOf(source.domain, DOMAINS, 'other'),
    taskType: oneOf(source.taskType, TASK_TYPES, 'validate'),
    source: {
      type: oneOf(sourceInput.type, SOURCE_TYPES, 'idea'),
      meetingId: typeof sourceInput.meetingId === 'string' ? sourceInput.meetingId : '',
    },
    ratings: normalizeRatings(source.ratings),
    compliance: oneOf(source.compliance, COMPLIANCE_LEVELS, 'medium'),
    status: oneOf(source.status, OPP_STATUSES, 'candidate'),
    ai: normalizeAi(source.ai),
    file: typeof source.file === 'string' && source.file !== '' ? source.file : `opportunities/${id}.md`,
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
  }
}

/** Normalize one meeting. */
export function normalizeMeeting(raw) {
  const source = isRecord(raw) ? raw : {}
  const id = typeof source.id === 'string' && source.id !== '' ? source.id : newId('m')
  return {
    id,
    title: line(source.title, 200),
    date: day(source.date),
    attendees: stringList(source.attendees, 40),
    file: typeof source.file === 'string' && source.file !== '' ? source.file : `meetings/${id}.md`,
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
  }
}

/** Normalize one research note. */
export function normalizeResearch(raw) {
  const source = isRecord(raw) ? raw : {}
  const id = typeof source.id === 'string' && source.id !== '' ? source.id : newId('r')
  const projectId = typeof source.projectId === 'string' ? source.projectId : ''
  return {
    id,
    title: line(source.title, 200),
    projectId,
    stage: source.stage === null || source.stage === undefined ? null : clampStage(source.stage),
    status: oneOf(source.status, RESEARCH_STATUSES, 'open'),
    question: block(source.question, 5000),
    conclusion: block(source.conclusion, 20_000),
    file: typeof source.file === 'string' && source.file !== '' ? source.file : defaultChildFile('research', projectId, id),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
  }
}

/** Where a document version lives. */
export function documentVersionPath(projectId, docId, version) {
  return projectId === ''
    ? `documents/${docId}/v${version}.md`
    : `projects/${projectId}/documents/${docId}/v${version}.md`
}

/** Normalize one delivery document, including its version chain. */
export function normalizeDoc(raw) {
  const source = isRecord(raw) ? raw : {}
  const id = typeof source.id === 'string' && source.id !== '' ? source.id : newId('d')
  const projectId = typeof source.projectId === 'string' ? source.projectId : ''
  const rawVersions = (Array.isArray(source.versions) ? source.versions : []).filter(isRecord)
  const versions = rawVersions.map((item, index) => normalizeVersion(item, index + 1))
  if (versions.length === 0) {
    const file = typeof source.file === 'string' && source.file !== ''
      ? source.file
      : documentVersionPath(projectId, id, 1)
    versions.push({ version: 1, file, createdAt: timestamp(source.createdAt), source: 'create' })
  }
  versions.sort((left, right) => left.version - right.version)
  const currentVersion = Number.isInteger(source.currentVersion) && source.currentVersion >= 1
    ? Math.min(source.currentVersion, versions.at(-1).version)
    : versions.at(-1).version
  const current = versions.find(item => item.version === currentVersion) ?? versions.at(-1)
  return {
    id,
    title: line(source.title, 200),
    template: oneOf(source.template, DOC_TEMPLATES, 'delivery'),
    projectId,
    stage: source.stage === null || source.stage === undefined ? null : clampStage(source.stage),
    status: oneOf(source.status, DOC_STATUSES, 'draft'),
    file: typeof source.file === 'string' && source.file !== '' ? source.file : current.file,
    versions: versions.slice(-MAX_DOCUMENTS),
    currentVersion,
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
  }
}

/** Where a project-owned body lives, falling back to a root folder. */
export function defaultChildFile(kind, projectId, id) {
  return projectId === '' ? `${kind}/${id}.md` : `projects/${projectId}/${kind}/${id}.md`
}

/** Normalize a whole state; never throws for field-level problems. */
export function normalizeState(raw) {
  const source = isRecord(raw) ? raw : {}
  const migration = isRecord(source.migration) ? source.migration : {}
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    updatedAt: timestamp(source.updatedAt),
    migration: {
      legacyImportedAt: typeof migration.legacyImportedAt === 'string' ? timestamp(migration.legacyImportedAt, '') || null : null,
      legacySchema: Number.isInteger(migration.legacySchema) ? migration.legacySchema : null,
      v2MigratedAt: typeof migration.v2MigratedAt === 'string' ? timestamp(migration.v2MigratedAt, '') || null : null,
    },
    projects: (Array.isArray(source.projects) ? source.projects : []).filter(isRecord).map(project => normalizeProject(project)),
    opportunities: (Array.isArray(source.opportunities) ? source.opportunities : []).filter(isRecord).map(normalizeOpportunity),
    meetings: (Array.isArray(source.meetings) ? source.meetings : []).filter(isRecord).map(normalizeMeeting),
    research: (Array.isArray(source.research) ? source.research : []).filter(isRecord).map(normalizeResearch),
    docs: (Array.isArray(source.docs) ? source.docs : []).filter(isRecord).map(normalizeDoc),
  }
}

/** Reject creation that would exceed a configured record budget. */
export function enforceLimits(state, limits, collection) {
  const actual = state[collection].length
  const maximum = limits[collection]
  if (Number.isInteger(maximum) && actual > maximum) {
    throw new WorkbenchError('state/limit', 409, `too many ${collection}: ${actual} > ${maximum}`, {
      collection,
      limit: maximum,
      actual,
    })
  }
}

/** Enforce per-project task, source, and document budgets. */
export function enforceProjectLimits(project, limits) {
  for (const [collection, maximum] of [['tasks', limits.tasks], ['sources', limits.sources]]) {
    if (Number.isInteger(maximum) && project[collection].length > maximum) {
      throw new WorkbenchError('state/limit', 409, `too many ${collection}: ${project[collection].length} > ${maximum}`, {
        collection,
        limit: maximum,
        actual: project[collection].length,
        projectId: project.id,
      })
    }
  }
}

/** The schema version a parsed document declares, or null. */
export function schemaVersionOf(raw) {
  return isRecord(raw) && Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : null
}
