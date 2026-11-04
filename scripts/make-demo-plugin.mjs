/**
 * Regenerate the demo plugin that ships in `plugins/demo-board`.
 *
 * `examples/demo-plugin` is the shape the Creator writes inside a profile
 * (reserved name, no market metadata). This script runs the same normalization
 * `dsh-market publish` runs and writes the result into the repository, where the
 * static index can point at it as a Git source.
 *
 * Run: `node scripts/make-demo-plugin.mjs`
 */

import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalize } from '../cli/src/normalize.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'plugins', 'demo-board')

await rm(target, { recursive: true, force: true })
const result = await normalize({
  sourceDir: join(root, 'examples', 'demo-plugin'),
  stagingDir: target,
  name: '@acme-community/demo-board',
  version: '1.0.0',
  title: '值班看板',
  description: '聚合本周值班、告警和待办',
  category: 'team',
  dshRange: '>=0.2.0 <0.3.0',
  author: { name: '平台组' },
})
console.log(`wrote ${target}: ${result.oldName} → ${result.name}@${result.version}`)
