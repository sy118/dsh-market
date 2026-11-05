/**
 * Evidence digest for a human stage decision.
 *
 * The digest covers the required deliverables by stable id, not file order, so
 * a later decision can tell whether the material changed since the last one.
 */
import { createHash } from 'node:crypto'

/** SHA-256 over id + content hash pairs, sorted by id. */
export function evidenceDigest(deliverables) {
  const entries = (Array.isArray(deliverables) ? deliverables : [])
    .filter(item => item?.required !== false)
    .map(item => `${item.id}:${item.hash ?? ''}`)
    .sort()
  return createHash('sha256').update(entries.join('\n'), 'utf8').digest('hex')
}
