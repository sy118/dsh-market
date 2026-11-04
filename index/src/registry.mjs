/**
 * Read a Verdaccio storage directory without talking to the registry.
 *
 * Layout relied on (Verdaccio 5 and 6):
 *   <storage>/<scope>/<name>/package.json   the packument
 *   <storage>/<scope>/<name>/<name>-<version>.tgz
 *
 * Reading the directory rather than the HTTP API keeps the service anonymous
 * and independent of registry auth, and avoids the search endpoint's paging.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Whether a directory entry is a scope directory for the configured scope. */
async function scopedPackageDirs(scopeDir) {
  let entries
  try {
    entries = await readdir(scopeDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

/**
 * Read every packument of the scope.
 * @param {string} storageDir - Verdaccio storage root.
 * @param {string} scope - package scope, with its `@`.
 * @returns {Promise<Array<{ name: string, dir: string, packument: object }>>} packages that carry a readable packument.
 */
export async function readPackages(storageDir, scope) {
  const scopeDir = join(storageDir, scope)
  const packages = []
  for (const directory of await scopedPackageDirs(scopeDir)) {
    const dir = join(scopeDir, directory)
    let packument
    try {
      packument = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    } catch (error) {
      // A half-written package directory is skipped; the next poll picks it up.
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) continue
      throw error
    }
    if (typeof packument?.name !== 'string' || !packument.name.startsWith(`${scope}/`)) continue
    if (packument.versions === undefined || typeof packument.versions !== 'object') continue
    packages.push({ name: packument.name, dir, packument })
  }
  return packages
}

/**
 * Locate the tarball of one version on disk.
 * @param {string} dir - package directory.
 * @param {string} name - package name, used to prefer the canonical file name.
 * @param {string} version - exact version.
 * @param {string[]} files - directory listing, reused across versions of one package.
 * @returns {string | undefined} absolute tarball path.
 */
export function tarballOf(dir, name, version, files) {
  const canonical = `${name.slice(name.indexOf('/') + 1)}-${version}.tgz`
  if (files.includes(canonical)) return join(dir, canonical)
  const suffixed = files.find((file) => file.endsWith(`-${version}.tgz`))
  return suffixed === undefined ? undefined : join(dir, suffixed)
}

/**
 * List a package directory once, for {@link tarballOf}.
 * @param {string} dir - package directory.
 * @returns {Promise<string[]>} file names, tarballs only.
 */
export async function tarballFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.tgz')).map((entry) => entry.name)
}

/**
 * Whether a file changed since a cached read.
 * @param {string} path - absolute path.
 * @param {{ mtimeMs: number, size: number } | undefined} cached - previous stat.
 * @returns {Promise<{ changed: boolean, stat?: { mtimeMs: number, size: number } }>} comparison result.
 */
export async function statChanged(path, cached) {
  try {
    const info = await stat(path)
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return { changed: false }
    return { changed: true, stat: { mtimeMs: info.mtimeMs, size: info.size } }
  } catch (error) {
    if (error?.code === 'ENOENT') return { changed: true }
    throw error
  }
}
