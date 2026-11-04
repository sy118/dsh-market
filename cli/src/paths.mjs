/** Find the plugin the Creator last generated inside this machine's profiles. */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './config.mjs'

/** Directory name and mtime of one candidate. */
async function candidates(profilesDir) {
  let profiles
  try {
    profiles = await readdir(profilesDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const found = []
  for (const profile of profiles.filter((entry) => entry.isDirectory())) {
    const createdDir = join(profilesDir, profile.name, 'created-plugins')
    let created
    try {
      created = await readdir(createdDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const candidate of created.filter((entry) => entry.isDirectory())) {
      const dir = join(createdDir, candidate.name)
      try {
        const info = await stat(join(dir, 'package.json'))
        found.push({ dir, profile: profile.name, mtimeMs: info.mtimeMs })
      } catch {
        continue
      }
    }
  }
  return found.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

/**
 * The most recently generated plugin directory across profiles.
 * @returns {Promise<{ dir: string, profile: string } | undefined>} newest candidate.
 */
export async function findLatestCreatedPlugin() {
  const [newest] = await candidates(join(dshHome(), 'profiles'))
  return newest === undefined ? undefined : { dir: newest.dir, profile: newest.profile }
}

/**
 * Every generated plugin the CLI could publish, newest first.
 * @returns {Promise<Array<{ dir: string, profile: string, name: string }>>} candidates with their package names.
 */
export async function listCreatedPlugins() {
  const found = []
  for (const candidate of await candidates(join(dshHome(), 'profiles'))) {
    try {
      const manifest = JSON.parse(await readFile(join(candidate.dir, 'package.json'), 'utf8'))
      found.push({ dir: candidate.dir, profile: candidate.profile, name: String(manifest.name ?? '') })
    } catch {
      continue
    }
  }
  return found
}
