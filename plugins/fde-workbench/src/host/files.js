/**
 * Markdown bodies: reads, hash-guarded writes, and size caps.
 *
 * The hash returned by a read is the caller's optimistic-concurrency token.
 * A write with a stale hash is refused instead of overwriting an edit made by
 * an agent or another tab.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkbenchError, assertRealInside, resolveInside, resolveInsideAny } from './paths.js'

/** Content hash used as the file version token. */
export function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Recursively sum file sizes under a directory. */
async function directoryBytes(directory) {
  let total = 0
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }
  for (const entry of entries) {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else if (entry.isFile()) total += (await stat(child)).size
  }
  return total
}

/** Read and write Markdown bodies under the data root. */
export class WorkbenchFiles {
  /**
   * @param {object} options - root and limits.
   */
  constructor(options) {
    this.root = options.root
    this.limits = options.limits
    this.logger = options.logger
  }

  /**
   * Read one body.
   * @param {string} relativePath - POSIX relative `.md` path.
   * @returns {Promise<{path: string, text: string, hash: string, bytes: number}>}
   */
  async read(relativePath) {
    const { absolute, relative } = resolveInside(this.root, relativePath)
    await assertRealInside(this.root, absolute)
    let text
    try {
      text = await readFile(absolute, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') throw new WorkbenchError('file/not-found', 404, `no such file: ${relative}`)
      throw error
    }
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > this.limits.fileBytes) {
      throw new WorkbenchError('file/too-large', 413, 'file exceeds the configured size', { bytes, limit: this.limits.fileBytes })
    }
    return { path: relative, text, hash: hashText(text), bytes }
  }

  /**
   * Write one body.
   * @param {string} relativePath - POSIX relative `.md` path.
   * @param {string} text - new content.
   * @param {string|null} [baseHash] - hash the caller read, when guarding an edit.
   */
  async write(relativePath, text, baseHash) {
    if (typeof text !== 'string') throw new WorkbenchError('file/invalid', 400, 'content must be a string')
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > this.limits.fileBytes) {
      throw new WorkbenchError('file/too-large', 413, 'file exceeds the configured size', { bytes, limit: this.limits.fileBytes })
    }
    const { absolute, relative } = resolveInside(this.root, relativePath)
    await mkdir(dirname(absolute), { recursive: true })
    await assertRealInside(this.root, absolute)

    let current
    try {
      current = await readFile(absolute, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (typeof baseHash === 'string' && baseHash !== '') {
      if (current === undefined || hashText(current) !== baseHash) {
        throw new WorkbenchError('file/conflict', 409, 'file changed since it was read', {
          path: relative,
          hash: current === undefined ? null : hashText(current),
        })
      }
    }

    const total = await directoryBytes(this.root)
    if (total + bytes - Buffer.byteLength(current ?? '', 'utf8') > this.limits.totalBytes) {
      throw new WorkbenchError('file/quota', 413, 'data directory exceeds the configured total size', {
        bytes: total,
        limit: this.limits.totalBytes,
      })
    }

    const temp = `${absolute}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
    await writeFile(temp, text, 'utf8')
    try {
      await rename(temp, absolute)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    return { path: relative, hash: hashText(text), bytes }
  }

  /** Delete one body when it exists. */
  async remove(relativePath) {
    const { absolute } = resolveInside(this.root, relativePath)
    try {
      await rm(absolute, { force: true })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  /** Whether a body currently exists. */
  async exists(relativePath) {
    const { absolute } = resolveInside(this.root, relativePath)
    try {
      await stat(absolute)
      return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }

  /**
   * Inspect a Markdown body without throwing for a missing file.
   * @param {string} relativePath - project-relative `.md` path.
   * @returns {Promise<{status: string, bytes: number, hash: string, updatedAt: string|null, error: string|null}>}
   */
  async inspect(relativePath) {
    const { absolute } = resolveInside(this.root, relativePath)
    try {
      const info = await stat(absolute)
      if (!info.isFile()) {
        return { status: 'error', bytes: 0, hash: '', updatedAt: null, error: 'not a regular file' }
      }
      if (info.size > this.limits.fileBytes) {
        return { status: 'error', bytes: info.size, hash: '', updatedAt: null, error: 'file exceeds the configured size' }
      }
      const text = await readFile(absolute, 'utf8')
      if (text.trim() === '') {
        return { status: 'missing', bytes: info.size, hash: hashText(text), updatedAt: info.mtime.toISOString(), error: null }
      }
      return {
        status: 'present',
        bytes: info.size,
        hash: hashText(text),
        updatedAt: info.mtime.toISOString(),
        error: null,
      }
    } catch (error) {
      if (error.code === 'ENOENT') return { status: 'missing', bytes: 0, hash: '', updatedAt: null, error: null }
      return {
        status: 'error',
        bytes: 0,
        hash: '',
        updatedAt: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Read any safe file under the root as a Buffer. */
  async readBinary(relativePath, maxBytes = this.limits.sourceBytes) {
    const { absolute, relative } = resolveInsideAny(this.root, relativePath)
    await assertRealInside(this.root, absolute)
    let buffer
    try {
      buffer = await readFile(absolute)
    } catch (error) {
      if (error.code === 'ENOENT') throw new WorkbenchError('file/not-found', 404, `no such file: ${relative}`)
      throw error
    }
    if (buffer.byteLength > maxBytes) {
      throw new WorkbenchError('file/too-large', 413, 'file exceeds the configured size', {
        bytes: buffer.byteLength,
        limit: maxBytes,
      })
    }
    return { path: relative, buffer, bytes: buffer.byteLength, hash: createHash('sha256').update(buffer).digest('hex') }
  }

  /** Write any safe file under the root atomically. */
  async writeBinary(relativePath, buffer, options = {}) {
    if (!Buffer.isBuffer(buffer)) throw new WorkbenchError('file/invalid', 400, 'content must be a buffer')
    const { absolute, relative } = resolveInsideAny(this.root, relativePath)
    await mkdir(dirname(absolute), { recursive: true })
    await assertRealInside(this.root, absolute)
    const total = await directoryBytes(this.root)
    let current = 0
    try {
      current = (await stat(absolute)).size
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (total - current + buffer.byteLength > this.limits.totalBytes) {
      throw new WorkbenchError('file/quota', 413, 'data directory exceeds the configured total size', {
        bytes: total,
        limit: this.limits.totalBytes,
      })
    }
    const temp = `${absolute}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
    await writeFile(temp, buffer)
    try {
      await rename(temp, absolute)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    return {
      path: relative,
      bytes: buffer.byteLength,
      hash: createHash('sha256').update(buffer).digest('hex'),
      ...(options.extra ?? {}),
    }
  }

  /** Remove a directory tree under the root when it exists. */
  async removeDir(relativePath) {
    const { absolute } = resolveInsideAny(this.root, relativePath)
    try {
      await rm(absolute, { recursive: true, force: true })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
