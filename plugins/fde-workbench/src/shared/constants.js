/**
 * Values shared by the host, the browser bundle, and the tests.
 *
 * Everything in this file is data: option ids, weights, and limits. User
 * facing labels live in `src/client/i18n/*.js` so the same record can be
 * rendered in either language.
 */

/** Sidebar entry id and main-panel key; both must stay equal. */
export const PANEL_ID = 'fde-workbench'

/** Locale namespace owned by the plugin. */
export const LOCALE_NS = 'fdeWorkbench'

/** Current on-disk record schema. A higher version opens read-only. */
export const SCHEMA_VERSION = 2

/** Delivery stages, from discovery to continuous improvement. */
export const STAGE_COUNT = 8

/** Project delivery states. */
export const PROJECT_STATUSES = ['active', 'paused', 'completed', 'stopped']

/** Derived stage states; never stored as a user-editable value. */
export const STAGE_STATUSES = ['working', 'blocked', 'review-ready']

/** The four human decisions at a stage review. */
export const DECISION_OUTCOMES = ['go', 'revise', 'narrow', 'stop']

/** Task lifecycle. */
export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled']

/** Task priority. */
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent']

/** One project task, one dependency edge. */
export const MAX_TASKS = 200
export const MAX_SOURCES = 100
export const MAX_DOCUMENTS = 200

/** Source uploads. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
export const MAX_SOURCE_REQUEST_BYTES = 40 * 1024 * 1024
export const TEXT_PREVIEW_BYTES = 256 * 1024

/** Finance domains an opportunity can belong to. */
export const DOMAINS = ['reporting', 'ap', 'ar', 'expense', 'close', 'tax', 'audit', 'fpa', 'treasury', 'shared', 'other']

/** The AI action an opportunity asks for. */
export const TASK_TYPES = ['extract', 'validate', 'summarize', 'generate', 'classify', 'analyze', 'qa', 'orchestrate']

/** Workflow state of an opportunity, independent of its fit verdict. */
export const OPP_STATUSES = ['candidate', 'validating', 'pilot', 'adopted', 'parked', 'rejected']

/** Compliance sensitivity; high budgets the verdict at "validate". */
export const COMPLIANCE_LEVELS = ['low', 'medium', 'high']

/** Where an opportunity came from. */
export const SOURCE_TYPES = ['meeting', 'idea', 'process']

/** Evidence kinds kept per stage. */
export const ARTIFACT_KINDS = ['doc', 'code', 'report', 'record', 'data']

/** Evidence lifecycle. */
export const ARTIFACT_STATUSES = ['draft', 'pending', 'verified']

/** Blocker severity. */
export const SEVERITIES = ['high', 'medium', 'low']

/** Research lifecycle. */
export const RESEARCH_STATUSES = ['open', 'researching', 'finding', 'closed']

/** Delivery document lifecycle. */
export const DOC_STATUSES = ['draft', 'review', 'approved', 'archived']

/** Built-in document templates. */
export const DOC_TEMPLATES = ['proposal', 'research', 'delivery', 'acceptance', 'retro']

/** Feasibility dimensions and weights; they sum to 100. */
export const DIMENSIONS = [
  { key: 'data', weight: 25 },
  { key: 'rules', weight: 25 },
  { key: 'review', weight: 20 },
  { key: 'value', weight: 20 },
  { key: 'adoption', weight: 10 },
]

/** Verdict thresholds, inclusive lower bounds. */
export const SCORE_THRESHOLDS = { pilot: 75, validate: 55 }

/** Default target record counts; the host rejects creation beyond these. */
export const DEFAULT_COUNTS = {
  projects: 200,
  opportunities: 2000,
  meetings: 1000,
  research: 2000,
  docs: 2000,
  tasks: 200,
  sources: 100,
  documents: 200,
}

/** Upper bound on candidates returned by one extraction. */
export const MAX_CANDIDATES = 12

/** AI task ids understood by the host. */
export const AI_TASKS = ['opportunity.assess', 'meeting.extract', 'research.synthesize', 'doc.draft', 'stage.review', 'assistant.chat', 'assistant.command']

/** Tasks whose answer must be JSON rather than Markdown. */
export const STRUCTURED_TASKS = new Set(['opportunity.assess', 'meeting.extract', 'assistant.command'])
