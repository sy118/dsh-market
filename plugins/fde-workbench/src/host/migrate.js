/**
 * One-time import of the previous plugin's browser state.
 *
 * The old workbench kept everything in `localStorage` (`schemaVersion: 2`).
 * This module maps that snapshot into the new records and Markdown bodies; it
 * is pure so the route can decide when to persist and whether the import is
 * already done.
 */
import { SCHEMA_VERSION } from '../shared/constants.js'
import { WorkbenchError } from './paths.js'
import {
  isRecord,
  newId,
  normalizeMeeting,
  normalizeOpportunity,
  normalizeProject,
} from './schema.js'

const LABELS = {
  zh: { customer: '客户', owner: '负责人', target: '目标日期', background: '背景', notes: '纪要原文' },
  en: { customer: 'Customer', owner: 'Owner', target: 'Target date', background: 'Context', notes: 'Minutes' },
}

/** Keep a legacy id when it is safe in a path, otherwise mint one. */
function legacyId(value, prefix) {
  if (typeof value !== 'string') return newId(prefix)
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)
  return cleaned === '' ? newId(prefix) : cleaned
}

/** Markdown for an imported project. */
function projectMarkdown(project, locale) {
  const labels = LABELS[locale] ?? LABELS.zh
  const lines = [`# ${project.name}`, '']
  if (project.customer !== '') lines.push(`- ${labels.customer}: ${project.customer}`)
  if (project.owner !== '') lines.push(`- ${labels.owner}: ${project.owner}`)
  if (project.targetDate !== '') lines.push(`- ${labels.target}: ${project.targetDate}`)
  lines.push('', `## ${labels.background}`, '')
  return `${lines.join('\n')}\n`
}

/** Markdown body for an imported opportunity. */
function opportunityMarkdown(opportunity) {
  return `# ${opportunity.title}\n\n${opportunity.description.trim()}\n`
}

/** Markdown body for an imported meeting. */
function meetingMarkdown(meeting, notes, locale) {
  const labels = LABELS[locale] ?? LABELS.zh
  return `# ${meeting.title}\n\n## ${labels.notes}\n\n${notes.trim()}\n`
}

/**
 * Convert a legacy v2 snapshot.
 * @param {object} legacy - parsed localStorage value.
 * @param {object} [options] - locale used for generated bodies.
 * @returns {{state: object, files: Array<{path: string, text: string}>, counts: object}}
 */
export function legacyToState(legacy, options = {}) {
  if (!isRecord(legacy)) throw new WorkbenchError('migration/invalid', 400, 'legacy state must be an object')
  if (legacy.version !== 2) {
    throw new WorkbenchError('migration/unsupported', 400, `legacy schema ${String(legacy.version)} is not supported`, {
      version: legacy.version,
    })
  }
  const locale = options.locale === 'en' ? 'en' : 'zh'
  const files = []
  const now = new Date().toISOString()

  const projects = []
  const rawProjects = Array.isArray(legacy.projects) ? legacy.projects.filter(isRecord) : []
  for (const raw of rawProjects) {
    const project = normalizeProject({ ...raw, id: legacyId(raw.id, 'p') }, locale)
    project.file = `projects/${project.id}/project.md`
    files.push({ path: project.file, text: projectMarkdown(project, locale) })
    const rawStages = Array.isArray(raw.stages) ? raw.stages : []
    project.stages.forEach((stage, index) => {
      const note = isRecord(rawStages[index]) && typeof rawStages[index].note === 'string' ? rawStages[index].note : ''
      if (note.trim() === '') return
      const path = `projects/${project.id}/stages/${index}.md`
      stage.noteFile = path
      files.push({ path, text: note })
    })
    projects.push(project)
  }

  const meetingIds = new Map()
  const meetings = []
  const rawMeetings = Array.isArray(legacy.meetings) ? legacy.meetings.filter(isRecord) : []
  for (const raw of rawMeetings) {
    const meeting = normalizeMeeting({ ...raw, id: legacyId(raw.id, 'm') })
    meeting.file = `meetings/${meeting.id}.md`
    const notes = typeof raw.notes === 'string' ? raw.notes : ''
    files.push({ path: meeting.file, text: meetingMarkdown(meeting, notes, locale) })
    meetingIds.set(raw.id, meeting.id)
    meetings.push(meeting)
  }

  const opportunities = []
  const rawOpportunities = Array.isArray(legacy.opportunities) ? legacy.opportunities.filter(isRecord) : []
  for (const raw of rawOpportunities) {
    const source = isRecord(raw.source) ? raw.source : {}
    const mappedMeeting = source.meetingId === undefined ? '' : (meetingIds.get(source.meetingId) ?? '')
    const opportunity = normalizeOpportunity({
      ...raw,
      id: legacyId(raw.id, 'o'),
      source: { ...source, meetingId: mappedMeeting },
      ai: null,
    })
    opportunity.file = `opportunities/${opportunity.id}.md`
    files.push({ path: opportunity.file, text: opportunityMarkdown(opportunity) })
    opportunities.push(opportunity)
  }

  return {
    state: {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
      updatedAt: now,
      migration: { legacyImportedAt: now, legacySchema: 2 },
      projects,
      opportunities,
      meetings,
      research: [],
      docs: [],
    },
    files,
    counts: { projects: projects.length, opportunities: opportunities.length, meetings: meetings.length },
  }
}
