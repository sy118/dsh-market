/**
 * Deterministic stage review state.
 *
 * A file existing is not evidence that the work is good, but a stage cannot be
 * reviewed until the agreed minimum exists. This module only checks structure:
 * four work items done, required deliverables present, no open high/critical
 * blocker. The host and the browser must agree on it.
 */

/** Whether a blocker still blocks review. */
export function blockingBlocker(blocker) {
  return blocker?.resolved !== true && (blocker?.severity === 'high' || blocker?.severity === 'critical')
}

/** Whether a deliverable must be present for review. */
export function requiredDeliverable(deliverable) {
  return deliverable?.required !== false
}

/**
 * Compute the review blockers for one stage.
 * @param {object} stage - normalized stage record.
 * @returns {Array<object>} stable codes and the data needed to render them.
 */
export function reviewBlockers(stage) {
  const blockers = []
  const work = Array.isArray(stage?.work) ? stage.work : []
  const openWork = work.filter(item => item.done !== true)
  if (openWork.length > 0) {
    blockers.push({ code: 'stage.review.work', count: openWork.length, total: work.length })
  }
  for (const deliverable of Array.isArray(stage?.deliverables) ? stage.deliverables : []) {
    if (!requiredDeliverable(deliverable)) continue
    if (deliverable.status === 'error') {
      blockers.push({
        code: 'stage.review.artifactError',
        title: deliverable.title ?? '',
        path: deliverable.path ?? '',
        message: deliverable.error ?? '',
      })
    } else if (deliverable.status !== 'present') {
      blockers.push({
        code: 'stage.review.artifactMissing',
        title: deliverable.title ?? '',
        path: deliverable.path ?? '',
      })
    }
  }
  for (const blocker of Array.isArray(stage?.blockers) ? stage.blockers : []) {
    if (blockingBlocker(blocker)) {
      blockers.push({
        code: 'stage.review.blocker',
        text: blocker.text ?? '',
        severity: blocker.severity ?? 'high',
        blockerId: blocker.id ?? '',
      })
    }
  }
  return blockers
}

/**
 * Derive `working`, `blocked`, or `review-ready`.
 * @param {object} stage - normalized stage record.
 * @returns {{status: string, blockers: Array<object>}}
 */
export function stageState(stage) {
  const blockers = reviewBlockers(stage)
  if (blockers.some(item => item.code === 'stage.review.blocker')) {
    return { status: 'blocked', blockers }
  }
  if (blockers.length === 0) return { status: 'review-ready', blockers }
  return { status: 'working', blockers }
}
