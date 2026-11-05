/**
 * Schema v1 -> v2 migration.
 *
 * v1 kept every project inside `workbench.json`. v2 keeps project summaries in
 * the index and per-project records in `.fde/`. The migration is pure: the
 * store backs up the original file, writes the v2 state, and creates mirrors.
 */
import { SCHEMA_VERSION } from '../shared/constants.js'
import { isRecord, normalizeState } from './schema.js'

/**
 * Convert a parsed v1 document.
 * @param {object} raw - parsed `workbench.json`.
 * @param {object} [options] - locale for generated stage copy.
 * @returns {object} normalized v2 state.
 */
export function migrateV1State(raw, options = {}) {
  if (!isRecord(raw) || raw.schemaVersion !== 1) {
    throw new Error('migrateV1State expects a schemaVersion 1 document')
  }
  const now = new Date().toISOString()
  const state = normalizeState({
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    revision: Number.isInteger(raw.revision) ? raw.revision : 0,
    updatedAt: now,
    migration: {
      ...(isRecord(raw.migration) ? raw.migration : {}),
      v2MigratedAt: now,
    },
  }, options.locale)
  // Normalization already appends the fourth fixed work item, keeps the three
  // legacy items, turns legacy decisions into reviewable history, and gives
  // every document a v1 version entry.
  for (const project of state.projects) {
    if (project.status === 'active' && project.deliveredAt !== null) project.status = 'completed'
    project.updatedAt = now
  }
  state.updatedAt = now
  return state
}
