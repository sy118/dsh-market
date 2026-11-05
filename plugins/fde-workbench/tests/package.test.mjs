/** Package metadata, locale, icon, bundle, and catalog entry. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(dir, '..', '..')

test('package: market fields are present and consistent', async () => {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@acme-community/fde-workbench')
  assert.match(pkg.version, /^\d+\.\d+\.\d+/)
  assert.equal(pkg.engines.dsh, '>=0.2.0 <0.3.0')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dshMarket.category, 'productivity')
  assert.ok(pkg.author.name.length > 0)
  assert.ok(pkg.license.length > 0)
  assert.ok(pkg.description.length > 0)
  assert.ok(pkg.keywords.includes('productivity'))
  for (const entry of ['.', './client', './locale/*.json', './icon']) assert.ok(pkg.exports[entry] !== undefined, entry)
  for (const entry of ['index.js', 'client.js', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md', 'src/host', 'src/shared']) {
    assert.ok(pkg.files.includes(entry), `files missing ${entry}`)
  }
  assert.equal(pkg.files.includes('src/client'), false)
  assert.equal(pkg.files.includes('tests'), false)
  assert.equal(pkg.files.includes('build.mjs'), false)
})

test('package: cordis patch id and package name agree', async () => {
  const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: fde-workbench/)
  assert.match(patch, /name: '@acme-community\/fde-workbench'/)
})

test('locale: both meta blocks name the plugin', async () => {
  const zh = JSON.parse(await readFile(join(dir, 'locale/zh.json'), 'utf8'))
  const en = JSON.parse(await readFile(join(dir, 'locale/en.json'), 'utf8'))
  assert.equal(zh.meta.title, '交付工作台')
  assert.equal(en.meta.title, 'Delivery workbench')
  assert.ok(zh.meta.description.length > 20)
  assert.ok(en.meta.description.length > 20)
})

test('icon: 64x64, labelled, and small enough to inline', async () => {
  const file = await stat(join(dir, 'icon.svg'))
  const svg = await readFile(join(dir, 'icon.svg'), 'utf8')
  assert.ok(file.size < 32 * 1024)
  assert.match(svg, /viewBox="0 0 64 64"/)
  assert.match(svg, /role="img"/)
  assert.match(svg, /aria-label="[^"]+"/)
})

test('bundle: built client.js is the loader artifact and within size', async () => {
  const code = await readFile(join(dir, 'client.js'), 'utf8')
  const file = await stat(join(dir, 'client.js'))
  assert.ok(file.size < 2 * 1024 * 1024)
  assert.ok(code.includes('window.__ModuleLoader__.load'))
  assert.ok(code.includes('@acme-community/fde-workbench'))
  assert.equal(/(^|\n)\s*(import|export)\s/.test(code), false)
})

test('catalog: the plugin is listed with a productivity entry', async () => {
  const catalog = JSON.parse(await readFile(join(repo, 'catalog.json'), 'utf8'))
  const entry = catalog.plugins.find(item => item.path === 'plugins/fde-workbench')
  assert.ok(entry !== undefined)
  assert.equal(entry.category, 'productivity')
  assert.equal(entry.title.zh, '交付工作台')
  assert.ok(entry.description.en.length > 20)
})
