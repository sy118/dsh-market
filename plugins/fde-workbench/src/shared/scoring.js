/**
 * Deterministic AI-fit scoring.
 *
 * The model may propose ratings, but the number the workbench shows is always
 * recomputed here: weights are fixed, high compliance caps the verdict, and a
 * weak reviewability score blocks a pilot. Notes are stable codes so the
 * browser can render them in either language.
 */
import { DIMENSIONS, SCORE_THRESHOLDS } from './constants.js'

/** Clamp one rating to 1–5, defaulting to 3. */
export function clampRating(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 3
  return Math.min(5, Math.max(1, Math.round(number)))
}

/** Normalize a ratings object into the five known dimensions. */
export function normalizeRatings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const ratings = {}
  for (const dimension of DIMENSIONS) ratings[dimension.key] = clampRating(source[dimension.key])
  return ratings
}

/**
 * Score one opportunity.
 * @param {object} ratings - five 1–5 values.
 * @param {string} compliance - `low`, `medium`, or `high`.
 * @returns {object} score, verdict, weakest dimension, ratings, and reason codes.
 */
export function scoreOpportunity(ratings, compliance) {
  const values = normalizeRatings(ratings)
  let weighted = 0
  let weakest = DIMENSIONS[0].key
  let weakestValue = Number.POSITIVE_INFINITY
  for (const dimension of DIMENSIONS) {
    const value = values[dimension.key]
    weighted += (value / 5) * dimension.weight
    if (value < weakestValue) {
      weakestValue = value
      weakest = dimension.key
    }
  }
  const score = Math.round(weighted)
  let verdict = score >= SCORE_THRESHOLDS.pilot ? 'pilot' : score >= SCORE_THRESHOLDS.validate ? 'validate' : 'hold'
  const notes = []
  if (compliance === 'high') {
    notes.push('compliance-gate')
    if (verdict === 'pilot') {
      verdict = 'validate'
      notes.push('compliance-cap')
    }
    if (values.review <= 2) {
      verdict = 'hold'
      notes.push('review-gate')
    }
  } else if (values.review <= 2) {
    notes.push('review-weak')
  }
  for (const key of ['data', 'rules', 'adoption']) {
    if (values[key] <= 2) notes.push(`weak-${key}`)
  }
  return { score, verdict, weakest, ratings: values, notes }
}

/** Whether the derived verdict allows a pilot. */
export function verdictAllowsPilot(verdict) {
  return verdict === 'pilot'
}
