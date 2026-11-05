/**
 * Host configuration: one data root, explicit limits, and the optional model
 * route. Every value has a safe default so the plugin works with no config at
 * all; invalid values fall back and are reported as warnings.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { DEFAULT_COUNTS, MAX_SOURCE_BYTES, MAX_SOURCE_REQUEST_BYTES } from '../shared/constants.js'

/** Default size limits, in bytes. */
export const DEFAULT_LIMITS = {
  /** Whole `workbench.json`, before pretty-printing. */
  stateBytes: 16 * 1024 * 1024,
  /** One Markdown body. */
  fileBytes: 512 * 1024,
  /** All bodies plus the state file under the root. */
  totalBytes: 512 * 1024 * 1024,
  /** Ordinary JSON request body (`mutate`, `file`, `handoff`). */
  requestBytes: 1024 * 1024,
  /** One uploaded source file. */
  sourceBytes: MAX_SOURCE_BYTES,
  /** JSON envelope carrying one base64 source file. */
  sourceRequestBytes: MAX_SOURCE_REQUEST_BYTES,
  /** AI request body, including the rendered records. */
  aiRequestBytes: 200 * 1024,
  /** Handoff message body. */
  handoffBytes: 32 * 1024,
  ...DEFAULT_COUNTS,
}

/** Default model controls; the route itself comes from the deployment. */
export const DEFAULT_AI = {
  provider: '',
  model: '',
  timeoutMs: 60_000,
  maxTokens: 4_096,
  temperature: 0.2,
}

/** Default handoff behaviour. */
export const DEFAULT_HANDOFF = {
  workspaceTitle: 'Delivery workbench',
  groupInWorkspace: true,
}

/** `$DSH_HOME`, falling back to `~/.dsh`. */
export function dshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured === '' ? join(homedir(), '.dsh') : resolve(configured)
}

/** Default data root, beside the profile rather than inside a workspace. */
export function defaultRoot(env = process.env) {
  return join(dshHome(env), 'fde-workbench')
}

/** Read a positive integer, or return the fallback. */
function positiveInt(value, fallback, minimum, maximum) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) return fallback
  return number
}

/** Read a finite number in a range, or return the fallback. */
function finiteInRange(value, fallback, minimum, maximum) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) return fallback
  return number
}

/**
 * Resolve raw plugin configuration into the shape the host consumes.
 * @param {object} [raw] - row configuration from the profile.
 * @returns {object} resolved config plus human-readable warnings.
 */
export function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const warnings = []

  let root = defaultRoot()
  if (typeof input.root === 'string' && input.root.trim() !== '') {
    const candidate = input.root.trim()
    if (isAbsolute(candidate)) {
      root = resolve(candidate)
    } else {
      root = resolve(candidate)
      warnings.push('config/root-relative')
    }
  } else if (input.root !== undefined) {
    warnings.push('config/root-invalid')
  }

  const limitsInput = input.limits !== null && typeof input.limits === 'object' ? input.limits : {}
  const limits = {
    stateBytes: positiveInt(limitsInput.stateBytes, DEFAULT_LIMITS.stateBytes, 64 * 1024, 256 * 1024 * 1024),
    fileBytes: positiveInt(limitsInput.fileBytes, DEFAULT_LIMITS.fileBytes, 1024, 16 * 1024 * 1024),
    totalBytes: positiveInt(limitsInput.totalBytes, DEFAULT_LIMITS.totalBytes, 1024 * 1024, 4 * 1024 * 1024 * 1024),
    requestBytes: positiveInt(limitsInput.requestBytes, DEFAULT_LIMITS.requestBytes, 1024, 64 * 1024 * 1024),
    sourceBytes: positiveInt(limitsInput.sourceBytes, DEFAULT_LIMITS.sourceBytes, 1024, 256 * 1024 * 1024),
    sourceRequestBytes: positiveInt(limitsInput.sourceRequestBytes, DEFAULT_LIMITS.sourceRequestBytes, 2048, 512 * 1024 * 1024),
    aiRequestBytes: positiveInt(limitsInput.aiRequestBytes, DEFAULT_LIMITS.aiRequestBytes, 4 * 1024, 8 * 1024 * 1024),
    handoffBytes: positiveInt(limitsInput.handoffBytes, DEFAULT_LIMITS.handoffBytes, 1024, 1024 * 1024),
    projects: positiveInt(limitsInput.projects, DEFAULT_LIMITS.projects, 1, 10_000),
    opportunities: positiveInt(limitsInput.opportunities, DEFAULT_LIMITS.opportunities, 1, 100_000),
    meetings: positiveInt(limitsInput.meetings, DEFAULT_LIMITS.meetings, 1, 100_000),
    research: positiveInt(limitsInput.research, DEFAULT_LIMITS.research, 1, 100_000),
    docs: positiveInt(limitsInput.docs, DEFAULT_LIMITS.docs, 1, 100_000),
    tasks: positiveInt(limitsInput.tasks, DEFAULT_LIMITS.tasks, 1, 10_000),
    sources: positiveInt(limitsInput.sources, DEFAULT_LIMITS.sources, 1, 10_000),
    documents: positiveInt(limitsInput.documents, DEFAULT_LIMITS.documents, 1, 10_000),
  }
  for (const key of Object.keys(limitsInput)) {
    if (!(key in limits)) warnings.push(`config/unknown-limit:${key}`)
  }

  const aiInput = input.ai !== null && typeof input.ai === 'object' ? input.ai : {}
  const ai = {
    provider: typeof aiInput.provider === 'string' ? aiInput.provider.trim() : DEFAULT_AI.provider,
    model: typeof aiInput.model === 'string' ? aiInput.model.trim() : DEFAULT_AI.model,
    timeoutMs: positiveInt(aiInput.timeoutMs, DEFAULT_AI.timeoutMs, 5_000, 600_000),
    maxTokens: positiveInt(aiInput.maxTokens, DEFAULT_AI.maxTokens, 128, 32_768),
    temperature: finiteInRange(aiInput.temperature, DEFAULT_AI.temperature, 0, 1),
  }
  if ((ai.provider === '') !== (ai.model === '')) {
    warnings.push('config/ai-route-incomplete')
    ai.provider = ''
    ai.model = ''
  }

  const handoffInput = input.handoff !== null && typeof input.handoff === 'object' ? input.handoff : {}
  const handoff = {
    workspaceTitle: typeof handoffInput.workspaceTitle === 'string' && handoffInput.workspaceTitle.trim() !== ''
      ? handoffInput.workspaceTitle.trim().slice(0, 80)
      : DEFAULT_HANDOFF.workspaceTitle,
    groupInWorkspace: handoffInput.groupInWorkspace !== false,
  }

  return { root, limits, ai, handoff, warnings }
}
