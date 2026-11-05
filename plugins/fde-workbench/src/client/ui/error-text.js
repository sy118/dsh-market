/** Stable error and AI-reason codes to their copy keys. */
const ERROR_KEYS = {
  'ai/timeout': 'error.timeout',
  'ai/cancelled': 'error.cancelled',
  'ai/unstructured': 'error.unstructured',
  'ai/empty': 'error.empty',
  'ai/truncated': 'error.truncated',
  'ai/busy': 'error.busy',
  'ai/unavailable': 'error.unavailable',
  'ai/failed': 'assistant.error',
  'network/failed': 'error.network',
  'state/conflict': 'error.conflict',
  'state/too-large': 'error.tooLarge',
  'file/too-large': 'error.tooLarge',
  'file/conflict': 'file.conflictTitle',
  'file/not-found': 'error.notFound',
  'request/invalid-json': 'error.invalidJson',
  'root/unavailable': 'error.root',
  'handoff/unavailable': 'handoff.failure',
  'handoff/create-failed': 'handoff.failure',
  'handoff/prompt-failed': 'handoff.failure',
}

const REASON_KEYS = {
  'ai/no-llm': 'ai.reason.no-llm',
  'ai/no-route': 'ai.reason.no-route',
  'ai/provider-missing': 'ai.reason.provider-missing',
  'ai/model-missing': 'ai.reason.model-missing',
  'ai/unavailable': 'ai.reason.unavailable',
  'ai/catalog-empty': 'ai.reason.catalog-empty',
  'ai/missing-credential': 'ai.reason.missing-credential',
}

const WARNING_KEYS = {
  'state/recovered-from-backup': 'warnings.recovered',
  'state/corrupt-quarantined': 'warnings.corrupt',
  'state/newer-version': 'warnings.newer',
  'state/migrated-v2': 'warnings.migrated',
  'config/root-relative': 'warnings.root-relative',
  'config/ai-route-incomplete': 'warnings.ai-route',
}

/** Translate an API error code. */
export function errorText(t, code, cause) {
  if (cause === 'MISSING_CREDENTIAL') return t('ai.reason.missing-credential')
  return t(ERROR_KEYS[code] ?? 'error.generic')
}

/** Translate an AI availability reason. */
export function aiReasonText(t, reason) {
  return t(REASON_KEYS[reason] ?? 'ai.reason.unavailable')
}

/** Translate a startup warning code; unknown codes are hidden. */
export function warningText(t, code) {
  if (typeof code === 'string' && code.startsWith('config/unknown-limit')) return t('warnings.unknown-limit')
  const key = WARNING_KEYS[code]
  return key === undefined ? null : t(key)
}
