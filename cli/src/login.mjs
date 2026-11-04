/** Exchange a registry account password for a token, and store it for pnpm. */

import { loadConfig, saveConfig, writeNpmToken } from './config.mjs'
import { ask, isInteractive, line } from './ui.mjs'

/**
 * Log in to the market's npm registry.
 * @param {object} options - command options.
 * @param {string} [options.registry] - registry URL; defaults to the stored one.
 * @param {string} [options.username] - account name; prompted when absent.
 * @param {string} [options.password] - account password; prompted when absent.
 * @param {string} [options.token] - token to store instead of logging in.
 * @returns {Promise<number>} process exit code.
 */
export async function login(options) {
  const config = await loadConfig()
  const registry = options.registry ?? config.registry
  if (registry === undefined) {
    line('No registry configured. Pass --registry https://npm.example.internal/ once.')
    return 1
  }
  if (options.token !== undefined) {
    const { path } = await writeNpmToken(registry, options.token)
    await saveConfig({ registry })
    line(`Token stored in ${path} for ${registry}`)
    return 0
  }
  if (!isInteractive() && (options.username === undefined || options.password === undefined)) {
    line('Non-interactive: pass --username and --password, or --token.')
    return 1
  }
  const username = options.username ?? await ask('Registry user name')
  const password = options.password ?? await ask('Password')
  if (username === '' || password === '') {
    line('A user name and password are required.')
    return 1
  }

  const endpoint = new URL(`-/user/org.couchdb.user:${encodeURIComponent(username)}`, registry)
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
    body: JSON.stringify({ name: username, password }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.token !== 'string') {
    const detail = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`
    line(`Login failed: ${detail}`)
    if (response.status === 409) line('The account exists with another password. Use --token with a registry token instead.')
    if (response.status === 401) line('Check the password, or use --token.')
    return 1
  }

  const { path } = await writeNpmToken(registry, body.token)
  await saveConfig({ registry, author: { name: username } })
  line(`Logged in as ${username}.`)
  line(`Token stored in ${path} (mode 600).`)
  if (config.indexUrl === undefined) line('Next: dsh-market publish, or set the index URL with --index on `list`.')
  return 0
}
