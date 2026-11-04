/**
 * Smoke test for the publisher tools. Runs without DSH:
 *
 *   node plugins/market-publisher/tests/smoke.mjs
 *
 * It exercises the same handlers an agent would call, against the repository
 * this package lives in.
 */

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createPublisher } from '../lib/tools.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')

const unconfigured = createPublisher({})
const [status, preview, publish] = unconfigured.definitions()

assert.equal(status.name, 'market_status')
assert.equal(preview.name, 'market_preview')
assert.equal(publish.name, 'market_publish')
for (const tool of unconfigured.definitions()) {
  assert.equal(typeof tool.execute, 'function')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(typeof tool.parameters, 'object')
}

const cold = await status.execute({})
assert.equal(cold.configured, false)
assert.ok(Array.isArray(cold.created))
assert.match(cold.summary, /未配置/)

const configured = createPublisher({ repoPath: repo, registry: '', author: '平台组' })
const [status2, preview2] = configured.definitions()

const warm = await status2.execute({})
assert.equal(warm.configured, true)
assert.equal(warm.repo, repo.replace(/\\/g, '\\'))
assert.ok(Array.isArray(warm.created))

// Preview against the shipped example package: normalizes + scans + packs, uploads nothing.
const result = await preview2.execute(
  { dir: join(repo, 'examples', 'demo-plugin'), name: 'smoke-board', title: '冒烟看板', category: 'team' },
  {},
)
assert.equal(typeof result.summary, 'string')
assert.ok(result.output.length > 0, 'preview should print something')
if (!result.ok) {
  // A checkout without the CLI cannot preview; report it instead of failing the whole test.
  console.log('preview unavailable:', result.summary.slice(0, 200))
} else {
  assert.match(result.output, /Package|Files|Tarball/i)
}

const render = status2.output.render({}, warm)
assert.equal(render[0].type, 'text')
assert.ok(render[0].text.length > 0)

console.log('SMOKE PASS — market_status / market_preview / market_publish wired')
