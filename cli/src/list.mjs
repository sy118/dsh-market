/** `dsh-market list` and `dsh-market config`: inspect the market and store defaults. */

import { loadConfig, saveConfig } from './config.mjs'
import { listCreatedPlugins } from './paths.mjs'
import { line } from './ui.mjs'

/** Print a padded table. */
function table(rows, headers) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => String(row[index] ?? '').length)))
  const render = (row) => row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ').trimEnd()
  line(render(headers))
  line(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows) line(render(row))
}

/**
 * List the plugins in a market index.
 * @param {object} options - command options.
 * @param {string} [options.index] - index URL; defaults to the stored one.
 * @returns {Promise<number>} process exit code.
 */
export async function list(options) {
  const config = await loadConfig()
  const indexUrl = options.index ?? config.indexUrl
  if (indexUrl === undefined) {
    line('No index URL configured. Pass --index https://market.example.internal/index.json')
    return 1
  }
  const response = await fetch(indexUrl, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    line(`Cannot read ${indexUrl}: HTTP ${response.status}`)
    return 1
  }
  const index = await response.json()
  const plugins = Array.isArray(index.plugins) ? index.plugins : []
  line(`${index.title?.zh ?? index.title?.en ?? 'market'} — ${plugins.length} plugin(s) at ${indexUrl}`)
  if (plugins.length === 0) return 0
  table(
    plugins.map((plugin) => [
      plugin.name,
      plugin.versions?.[0]?.version ?? '',
      plugin.metadata?.category ?? '',
      plugin.author ?? '',
      plugin.title?.zh ?? plugin.title?.en ?? '',
    ]),
    ['package', 'latest', 'category', 'author', 'title'],
  )
  return 0
}

/**
 * List the plugins this machine's Creator generated, newest first.
 * @returns {Promise<number>} process exit code.
 */
export async function created() {
  const plugins = await listCreatedPlugins()
  if (plugins.length === 0) {
    line('No generated plugins found under $DSH_HOME/profiles/*/created-plugins.')
    return 0
  }
  table(plugins.map((plugin) => [plugin.name, plugin.profile, plugin.dir]), ['package', 'profile', 'directory'])
  return 0
}

/**
 * Store defaults used by later commands.
 * @param {object} options - command options.
 * @param {string} [options.registry] - registry URL.
 * @param {string} [options.index] - index URL.
 * @param {string} [options.scope] - package scope for new plugins.
 * @param {string} [options.dshRange] - `engines.dsh` range to declare.
 * @returns {Promise<number>} process exit code.
 */
export async function configure(options) {
  const patch = {}
  if (options.registry !== undefined) patch.registry = options.registry
  if (options.index !== undefined) patch.indexUrl = options.index
  if (options.scope !== undefined) patch.scope = options.scope.startsWith('@') ? options.scope : `@${options.scope}`
  if (options.dshRange !== undefined) patch.dshRange = options.dshRange
  if (Object.keys(patch).length === 0) {
    const config = await loadConfig()
    line(JSON.stringify(config, null, 2))
    return 0
  }
  const config = await saveConfig(patch)
  line(JSON.stringify(config, null, 2))
  return 0
}
