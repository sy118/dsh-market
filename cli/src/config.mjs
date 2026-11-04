/**
 * Local state of the CLI: where the market lives, who publishes, and the npm
 * token publish uses. Everything supports an environment override so tests and
 * CI never touch the real home directory.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Root that holds this CLI's own state. */
export function marketHome() {
  return process.env.DSH_MARKET_HOME ?? join(homedir(), '.dsh-market')
}

/** Harness home that holds the profiles with created plugins. */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** The npm configuration file publish writes its token into. */
export function npmrcPath() {
  return process.env.DSH_MARKET_NPMRC ?? join(homedir(), '.npmrc')
}

/** Defaults a deployment expects to override once, through `dsh-market login`. */
export const DEFAULTS = {
  scope: '@acme-community',
  // `>=0.2.2` would reject 0.2.2 prereleases (semver orders them below 0.2.2),
  // and DSH evaluates the range with includePrerelease.
  dshRange: '>=0.2.0 <0.3.0',
}

/** Read the stored configuration; a missing or unreadable file is an empty configuration. */
export async function loadConfig() {
  try {
    const parsed = JSON.parse(await readFile(join(marketHome(), 'config.json'), 'utf8'))
    return { ...DEFAULTS, ...parsed }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...DEFAULTS }
    throw error
  }
}

/** Merge and persist configuration fields. */
export async function saveConfig(patch) {
  const directory = marketHome()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const next = { ...(await loadConfig()), ...patch }
  const path = join(directory, 'config.json')
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  return next
}

/** The `//host/path/:_authToken=` key npm and pnpm look up for one registry. */
export function npmrcKey(registryUrl) {
  const url = new URL(registryUrl)
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return `//${url.host}${path}:_authToken`
}

/**
 * Add or replace this registry's token in the npm configuration, keeping every
 * other line. The file is only readable by its owner.
 * @param {string} registryUrl - registry the token belongs to.
 * @param {string} token - token as the registry issued it.
 * @returns {Promise<{ path: string, created: boolean }>} what was written.
 */
export async function writeNpmToken(registryUrl, token) {
  const path = npmrcPath()
  let existing = ''
  let created = false
  try {
    existing = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    created = true
  }
  const key = npmrcKey(registryUrl)
  const lines = existing.split(/\r?\n/).filter((line) => line.trim() !== '' && !line.startsWith(`${key}=`))
  lines.push(`${key}=${token}`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 })
  await chmod(path, 0o600).catch(() => {})
  return { path, created }
}
