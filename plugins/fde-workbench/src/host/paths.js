/**
 * Path safety for the workbench data root.
 *
 * Records only ever carry POSIX relative paths. Every read or write resolves
 * against the configured root, rejects `..`/absolute/non-Markdown input, and
 * re-checks the real parent directory so a symlink cannot walk outside.
 */
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** A refused path or size, carrying the HTTP status the route should use. */
export class WorkbenchError extends Error {
  /**
   * @param {string} code - stable error code for the client.
   * @param {number} status - HTTP status.
   * @param {string} message - developer-facing message.
   * @param {object} [details] - optional structured details.
   */
  constructor(code, status, message, details) {
    super(message)
    this.name = 'WorkbenchError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** Reject a relative path that is absolute, escapes, or is not Markdown. */
export function assertRelativePath(input) {
  const cleaned = assertSafePath(input)
  if (!cleaned.endsWith('.md')) throw new WorkbenchError('path/type', 400, 'only .md files are allowed')
  return cleaned
}

/** Reject a path that is absolute, escapes, or contains unsafe segments. */
export function assertSafePath(input) {
  if (typeof input !== 'string') throw new WorkbenchError('path/invalid', 400, 'path must be a string')
  const cleaned = input.trim().replaceAll('\\', '/')
  if (cleaned === '' || cleaned.length > 320 || cleaned.includes('\0')) {
    throw new WorkbenchError('path/invalid', 400, 'path is empty or too long')
  }
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned) || cleaned.startsWith('//')) {
    throw new WorkbenchError('path/absolute', 400, 'path must be relative to the data root')
  }
  const segments = cleaned.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new WorkbenchError('path/traversal', 400, 'path contains an empty, current, or parent segment')
  }
  return segments.join('/')
}

/** Resolve any safe relative path inside the root, or throw. */
export function resolveInsideAny(root, input) {
  const relativePath = assertSafePath(input)
  const absolute = resolve(root, ...relativePath.split('/'))
  const fromRoot = relative(root, absolute)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new WorkbenchError('path/escape', 400, 'path escapes the data root')
  }
  return { absolute, relative: relativePath }
}

/** Resolve a relative record path inside the root, or throw. */
export function resolveInside(root, input) {
  const relativePath = assertRelativePath(input)
  const absolute = resolve(root, ...relativePath.split('/'))
  const fromRoot = relative(root, absolute)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new WorkbenchError('path/escape', 400, 'path escapes the data root')
  }
  return { absolute, relative: relativePath }
}

/** Create the root (and its parents) when missing. */
export async function ensureRoot(root) {
  await mkdir(root, { recursive: true })
  return root
}

/** Check that an existing path, or its nearest existing parent, is inside the real root. */
export async function assertRealInside(root, absolute) {
  let candidate = absolute
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const real = await realpath(candidate)
      const realRoot = await realpath(root)
      const fromRoot = relative(realRoot, real)
      if (candidate === absolute) {
        if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
          throw new WorkbenchError('path/escape', 400, 'path escapes the real data root')
        }
        return
      }
      const targetFromReal = relative(real, absolute)
      if (targetFromReal.startsWith('..') || isAbsolute(targetFromReal)) {
        throw new WorkbenchError('path/escape', 400, 'path escapes the real data root')
      }
      return
    } catch (error) {
      if (error instanceof WorkbenchError) throw error
      const parent = dirname(candidate)
      if (parent === candidate) break
      candidate = parent
    }
  }
  throw new WorkbenchError('path/unresolvable', 400, 'path cannot be resolved inside the data root')
}

/** Join a POSIX directory and name, keeping the result relative. */
export function joinRelative(...parts) {
  return parts.filter(part => part !== '').join('/')
}

/** Absolute path for a relative one, without containing checks. */
export function absoluteOf(root, relativePath) {
  return join(root, ...relativePath.split('/'))
}

/** Convert an absolute path under the root into a POSIX relative path. */
export function relativeOf(root, absolute) {
  return relative(root, absolute).split(sep).join('/')
}
