/**
 * Parsing and validation of model output.
 *
 * Models wrap JSON in fences, add a sentence of preamble, or return 6 when the
 * schema says 1–5. The parser is tolerant about the envelope and strict about
 * the fields: anything outside the declared range is reported, never silently
 * clamped into a record.
 */
import { COMPLIANCE_LEVELS, DOMAINS, MAX_CANDIDATES, TASK_TYPES } from '../../shared/constants.js'
import { clampRating } from '../../shared/scoring.js'

const VERDICTS = ['pilot', 'validate', 'hold']

/** Pull the first JSON object out of a model answer. */
export function extractJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced === null ? text : fenced[1]
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/** Validate the assessment object and collect field-level problems. */
export function validateAssessment(raw) {
  const invalid = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: null, invalid: ['assessment'] }
  }
  const source = raw.ratings !== null && typeof raw.ratings === 'object' ? raw.ratings : {}
  const ratings = {}
  for (const key of ['data', 'rules', 'review', 'value', 'adoption']) {
    const value = source[key]
    if (Number.isInteger(value) && value >= 1 && value <= 5) {
      ratings[key] = value
    } else if (value === undefined) {
      // Missing is different from wrong: the client may still apply the rest.
      invalid.push(`ratings.${key}.missing`)
    } else {
      invalid.push(`ratings.${key}`)
      ratings[key] = clampRating(value)
    }
  }
  const compliance = COMPLIANCE_LEVELS.includes(raw.compliance) ? raw.compliance : null
  if (compliance === null) invalid.push('compliance')
  const verdict = VERDICTS.includes(raw.verdict) ? raw.verdict : null
  if (verdict === null) invalid.push('verdict')
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 4000) : ''
  const conditions = Array.isArray(raw.conditions)
    ? raw.conditions.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 10)
    : []
  return {
    value: { ratings, compliance, verdict, rationale, conditions },
    invalid,
    complete: invalid.length === 0,
  }
}

/** Normalize one candidate; returns undefined when it carries no usable quote. */
function candidateOf(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const quote = typeof raw.quote === 'string' ? raw.quote.trim().slice(0, 600) : ''
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : ''
  if (quote === '' && title === '') return undefined
  const confidence = typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
    ? raw.confidence
    : 0.5
  return {
    title: title === '' ? quote.slice(0, 80) : title,
    quote,
    domain: DOMAINS.includes(raw.domain) ? raw.domain : 'other',
    taskType: TASK_TYPES.includes(raw.taskType) ? raw.taskType : 'validate',
    confidence,
  }
}

/** Validate and deduplicate an extraction answer. */
export function validateExtraction(raw) {
  const invalid = []
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.candidates)) {
    return { value: null, invalid: ['candidates'] }
  }
  const seen = new Set()
  const candidates = []
  let dropped = 0
  for (const item of raw.candidates) {
    const candidate = candidateOf(item)
    if (candidate === undefined) {
      dropped += 1
      continue
    }
    const key = `${candidate.title.toLowerCase()}\u0000${candidate.quote.toLowerCase()}`
    if (seen.has(key)) {
      dropped += 1
      continue
    }
    seen.add(key)
    candidates.push(candidate)
    if (candidates.length >= MAX_CANDIDATES) break
  }
  if (dropped > 0) invalid.push(`candidates.dropped:${dropped}`)
  return { value: { candidates }, invalid, complete: true }
}

/** Trim a Markdown answer and strip a wrapping fence. */
export function normalizeMarkdown(text) {
  if (typeof text !== 'string') return ''
  let value = text.trim()
  const fenced = value.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  if (fenced !== null) value = fenced[1].trim()
  return value
}

/** Normalize the one action the assistant is allowed to prepare. */
export function validateAssistantCommand(raw) {
  const invalid = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: null, invalid: ['command'] }
  }
  const reply = typeof raw.reply === 'string' ? raw.reply.trim().slice(0, 4000) : ''
  const wantsCreate = raw.action === 'project.create'
  const source = raw.project !== null && typeof raw.project === 'object' ? raw.project : {}
  const line = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const date = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '')
  const project = {
    name: line(source.name, 120),
    customer: line(source.customer, 120),
    owner: line(source.owner, 120),
    startDate: date(source.startDate),
    endDate: date(source.endDate),
    successCriteria: line(source.successCriteria, 4000),
    stakeholders: line(source.stakeholders, 4000),
  }
  if (wantsCreate && project.name === '') invalid.push('project.name')
  if (project.startDate !== '' && project.endDate !== '' && project.endDate < project.startDate) {
    invalid.push('project.dateOrder')
    project.startDate = ''
    project.endDate = ''
  }
  return {
    value: {
      reply,
      action: wantsCreate && project.name !== '' ? 'project.create' : 'none',
      project: wantsCreate ? project : null,
    },
    invalid,
    complete: invalid.length === 0,
  }
}

/**
 * Parse one model answer for a task.
 * @param {string} task - task id.
 * @param {string} text - accumulated model text.
 * @param {boolean} structured - whether the task expects JSON.
 */
export function parseTaskResult(task, text, structured) {
  if (!structured) {
    const markdown = normalizeMarkdown(text)
    if (markdown === '') return { result: null, invalid: [], error: 'ai/empty' }
    return { result: { markdown }, invalid: [], error: null }
  }
  const json = extractJson(text)
  if (json === null) return { result: null, invalid: [], error: 'ai/unstructured' }
  if (task === 'opportunity.assess') {
    const assessment = validateAssessment(json)
    if (assessment.value === null) return { result: null, invalid: assessment.invalid, error: 'ai/unstructured' }
    return { result: assessment.value, invalid: assessment.invalid, error: null }
  }
  if (task === 'meeting.extract') {
    const extraction = validateExtraction(json)
    if (extraction.value === null) return { result: null, invalid: extraction.invalid, error: 'ai/unstructured' }
    return { result: extraction.value, invalid: extraction.invalid, error: null }
  }
  if (task === 'assistant.command') {
    const command = validateAssistantCommand(json)
    if (command.value === null) return { result: null, invalid: command.invalid, error: 'ai/unstructured' }
    return { result: command.value, invalid: command.invalid, error: null }
  }
  return { result: json, invalid: [], error: null }
}
