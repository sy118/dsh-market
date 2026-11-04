/**
 * Minimal `.tar.gz` reader: enough to list a packed npm tarball and read the
 * handful of text/icon files a market index needs. Supports ustar, GNU
 * long names (`L`) and pax extended headers (`x`). No external dependency, so
 * the service image needs no native build step.
 *
 * Kept in sync with `cli/src/tar.mjs`; the CLI is published on its own and the
 * service is built from its own directory, so neither can import the other.
 */

import { gunzipSync } from 'node:zlib'

const BLOCK = 512
const MAX_ENTRY_BYTES = 64 * 1024 * 1024

/** Read a NUL-terminated UTF-8 string out of a fixed-width header field. */
function field(buffer, start, length) {
  let end = start
  while (end < start + length && buffer[end] !== 0) end += 1
  return buffer.toString('utf8', start, end)
}

/** Read a tar numeric field; tar writes octal, sometimes space-padded. */
function octal(buffer, start, length) {
  const text = field(buffer, start, length).trim()
  if (text === '') return 0
  const value = Number.parseInt(text, 8)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** Parse a pax extended header payload into its key/value records. */
function paxRecords(payload) {
  const records = {}
  let offset = 0
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset)
    if (space === -1) break
    const length = Number.parseInt(payload.toString('utf8', offset, space), 10)
    if (!Number.isFinite(length) || length <= 0 || offset + length > payload.length) break
    const record = payload.toString('utf8', space + 1, offset + length - 1)
    const equals = record.indexOf('=')
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return records
}

/**
 * List the regular files of a `.tar.gz`.
 * @param {Buffer} archive - the compressed tarball.
 * @returns {Map<string, Buffer>} path → contents.
 */
export function readTarGz(archive) {
  const tar = gunzipSync(archive)
  const files = new Map()
  let offset = 0
  let pendingName
  let pendingPaxPath
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const size = octal(header, 124, 12)
    if (size > MAX_ENTRY_BYTES) throw new Error(`tar entry declares ${size} bytes, over the ${MAX_ENTRY_BYTES}-byte limit`)
    const type = String.fromCharCode(header[156] === 0 ? 0x30 : header[156])
    const prefix = field(header, 345, 155)
    const base = field(header, 0, 100)
    const dataStart = offset + BLOCK
    const data = tar.subarray(dataStart, dataStart + size)
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK
    if (type === 'x') {
      pendingPaxPath = paxRecords(data).path ?? pendingPaxPath
      continue
    }
    if (type === 'g') continue
    if (type === 'L') {
      pendingName = data.toString('utf8')
      continue
    }
    if (type === 'K') continue
    let name = pendingPaxPath ?? pendingName ?? (prefix === '' ? base : `${prefix}/${base}`)
    pendingPaxPath = undefined
    pendingName = undefined
    if (type === '0' || type === '7') files.set(name, Buffer.from(data))
  }
  return files
}

/**
 * Strip the `package/` prefix npm adds to every tarball path.
 * @param {Map<string, Buffer>} files - entries as read from the tarball.
 * @returns {Map<string, Buffer>} entries relative to the package root.
 */
export function packageFiles(files) {
  const relative = new Map()
  for (const [path, contents] of files) {
    if (path.startsWith('package/')) relative.set(path.slice('package/'.length), contents)
  }
  return relative
}
