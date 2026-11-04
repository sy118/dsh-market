/**
 * End-to-end check without Docker: normalize the demo plugin, pack it, place it
 * in a fake Verdaccio storage directory, build the index, and serve it.
 *
 * Run from the repository root: `node scripts/smoke.mjs`
 */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalize } from '../cli/src/normalize.mjs'
import { scanPackage } from '../cli/src/scan.mjs'
import { readTarGz } from '../cli/src/tar.mjs'
import { buildMarket } from '../index/src/build.mjs'
import { loadConfig } from '../index/src/config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const NAME = '@acme-community/demo-board'
const VERSION = '1.0.0'

/** Run `pnpm pack`, tolerating a sandbox that forbids piped stdio. */
function pack(directory, destination) {
  const options = { cwd: directory, encoding: 'utf8', windowsHide: true, env: { ...process.env, CI: '1' } }
  const invoke = (stdio) => (process.platform === 'win32'
    ? spawnSync(`pnpm pack --pack-destination "${destination}"`, { ...options, shell: true, stdio })
    : spawnSync('pnpm', ['pack', '--pack-destination', destination], { ...options, stdio }))
  let run = invoke('pipe')
  if (run.error?.code === 'EPERM') run = invoke('inherit')
  assert.equal(run.status ?? 1, 0, `pnpm pack failed: ${run.stderr ?? ''}`)
  const archive = readdirSync(destination).filter((file) => file.endsWith('.tgz'))
  assert.equal(archive.length, 1, 'pnpm pack produced no tarball')
  return join(destination, archive[0])
}

/** Poll one URL until it answers. */
async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`timed out waiting for ${url}`)
}

const work = await mkdtemp(join(tmpdir(), 'dsh-market-smoke-'))
let server
try {
  const source = join(work, 'source')
  const staging = join(work, 'staging')
  const packDir = join(work, 'pack')
  const storage = join(work, 'storage', '@acme-community', 'demo-board')
  await cp(join(root, 'examples', 'demo-plugin'), source, { recursive: true })
  await mkdir(packDir, { recursive: true })
  await mkdir(storage, { recursive: true })

  const normalized = await normalize({
    sourceDir: source,
    stagingDir: staging,
    name: NAME,
    version: VERSION,
    title: '值班看板',
    description: '聚合本周值班、告警和待办',
    category: 'team',
    dshRange: '>=0.2.0 <0.3.0',
    author: { name: '张三', email: 'zhangsan@acme.test' },
  })
  assert.equal(normalized.oldName, '@dsh-local/view-7f3a1c2e-9b44-4c1e-8f0a-2d6c5b1e9a77')
  assert.ok(normalized.renamedFiles >= 2, 'the package name should be rewritten in the manifest and patch')

  const scan = await scanPackage(staging)
  assert.equal(scan.findings.filter((finding) => finding.severity === 'block').length, 0, 'the demo plugin must pass the gates')

  const tarball = await readFile(pack(staging, packDir))
  const files = readTarGz(tarball)
  const manifest = JSON.parse(files.get('package/package.json').toString('utf8'))
  assert.equal(manifest.name, NAME)
  assert.equal(manifest.engines.dsh, '>=0.2.0 <0.3.0')
  assert.equal(manifest.dshMarket.category, 'team')
  assert.ok(manifest.files.includes('locale'), 'the locale directory must ship')
  assert.ok(files.has('package/locale/zh.json'), 'a zh locale must be generated')
  assert.ok(files.has('package/icon.svg'), 'a default icon must be added')
  assert.ok(!files.has('package/node_modules'), 'no dependencies may leak into the package')

  // Fake Verdaccio storage: packument plus the tarball next to it.
  await writeFile(join(storage, 'demo-board-1.0.0.tgz'), tarball)
  await writeFile(join(storage, 'package.json'), JSON.stringify({
    name: NAME,
    'dist-tags': { latest: VERSION },
    versions: { [VERSION]: manifest },
    time: { [VERSION]: '2026-11-04T07:00:00.000Z' },
  }, null, 2))

  const config = loadConfig({
    REGISTRY_STORAGE: join(work, 'storage'),
    SCOPE: '@acme-community',
    REGISTRY_URL: 'http://127.0.0.1:4873/',
    PUBLIC_BASE_URL: 'https://market.acme.test',
    TITLE_ZH: '公司插件市场',
    TITLE_EN: 'Acme plugins',
  })
  const { index, icons, skipped } = await buildMarket(config, new Map(), new Set())
  assert.deepEqual(skipped, [], `nothing should be skipped: ${skipped.join('; ')}`)
  assert.equal(index.plugins.length, 1)
  const [plugin] = index.plugins
  assert.equal(plugin.name, NAME)
  assert.equal(plugin.metadata.category, 'team')
  assert.deepEqual(plugin.metadata.labels, ['unreviewed'])
  assert.equal(plugin.versions[0].version, VERSION)
  assert.equal(plugin.versions[0].engines.dsh, '>=0.2.0 <0.3.0')
  assert.equal(plugin.versions[0].source.registry, 'http://127.0.0.1:4873/')
  assert.ok(plugin.icon?.startsWith('data:image/svg+xml;base64,'), 'a small icon is inlined')
  assert.equal(icons.size, 0, 'a small icon needs no external file')

  const blocked = await buildMarket(config, new Map(), new Set([NAME]))
  assert.equal(blocked.index.plugins.length, 0, 'a blocked package disappears from the index')

  const empty = await buildMarket(loadConfig({ REGISTRY_STORAGE: join(work, 'absent'), SCOPE: '@acme-community' }), new Map(), new Set())
  assert.equal(empty.index.plugins.length, 0, 'an empty storage directory yields an empty index')

  // Serve it and read it back over HTTP, the way DSH reads an index source.
  const port = 18080 + Math.floor(Math.random() * 500)
  server = spawn(process.execPath, [join(root, 'index', 'src', 'server.mjs')], {
    env: {
      ...process.env,
      REGISTRY_STORAGE: join(work, 'storage'),
      SCOPE: '@acme-community',
      REGISTRY_URL: 'http://127.0.0.1:4873/',
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      PORT: String(port),
      HOST: '127.0.0.1',
      POLL_MS: '600000',
    },
    stdio: 'ignore',
  })
  await waitFor(`http://127.0.0.1:${port}/healthz`)
  const served = await (await fetch(`http://127.0.0.1:${port}/index.json`)).json()
  assert.equal(served.plugins.length, 1)
  assert.equal(served.plugins[0].name, NAME)
  const etag = (await fetch(`http://127.0.0.1:${port}/index.json`)).headers.get('etag')
  const cached = await fetch(`http://127.0.0.1:${port}/index.json`, { headers: { 'if-none-match': etag } })
  assert.equal(cached.status, 304, 'the index answers a conditional request')

  console.log('SMOKE PASS')
  console.log(`  index: ${index.plugins.length} plugin, ${index.plugins[0].versions.length} version(s)`)
  console.log(`  package: ${NAME}@${VERSION}, ${(tarball.length / 1024).toFixed(1)} KiB`)
} finally {
  server?.kill()
  await rm(work, { recursive: true, force: true })
}
