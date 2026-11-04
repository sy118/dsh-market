/**
 * Build the GitHub-hosted market index: `catalog.json` plus the plugin packages
 * committed under `plugins/`, compiled into a validated format-1 index and a
 * static landing page in `public/`.
 *
 * Version and compatibility come from each package's own manifest; the source of
 * every version is a commit-pinned Git entry in this repository, so installation
 * needs no registry.
 *
 * Usage:
 *   node scripts/build-static-index.mjs [--out public] [--url https://…/index.json]
 *                                       [--source git|npm] [--registry https://npm.…/]
 *
 * `--source git` (default) pins every version to a commit of this repository and
 * installs with `git+https://…`. `--source npm` instead points every version at
 * the registry it was published to, so installation is a plain npm install and
 * the repository only has to serve the index.
 *
 * Environment:
 *   MARKET_URL            index URL people add (default: the GitHub Pages URL)
 *   MARKET_REPO_URL       repository web URL (default: `git remote get-url origin`)
 *   GITHUB_REPOSITORY     `owner/name`, set by Actions
 *   GITHUB_SHA            commit to pin, set by Actions
 *   GITHUB_PAGES          null when not deployed
 *   MARKET_OFFICIAL_AUTHORS  comma-separated author names that get the `official` label
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, LABELS, validateIndex } from '../index/src/build.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const INLINE_ICON_BYTES = 32 * 1024
const ICON_TYPES = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/** Parse `--key value` arguments. */
function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      options[argument.slice(2)] = true
      continue
    }
    options[argument.slice(2)] = value
    index += 1
  }
  return options
}

/** Run git, or return undefined when it is unavailable or cannot be captured. */
function gitOptional(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/** Read HEAD without running git, for environments that block child processes. */
function readGitHead() {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref: ')) return head
    const ref = head.slice('ref: '.length).trim()
    try {
      return readFileSync(join(root, '.git', ref), 'utf8').trim()
    } catch {
      const packed = readFileSync(join(root, '.git', 'packed-refs'), 'utf8')
      for (const line of packed.split('\n')) {
        const [sha, name] = line.trim().split(' ')
        if (name === ref) return sha
      }
      return undefined
    }
  } catch {
    return undefined
  }
}

/** The repository web URL to pin versions to. */
function repositoryUrl(options) {
  if (typeof options.repo === 'string') return options.repo.replace(/\.git$/, '').replace(/\/+$/, '')
  if (process.env.MARKET_REPO_URL !== undefined && process.env.MARKET_REPO_URL !== '') {
    return process.env.MARKET_REPO_URL.replace(/\.git$/, '').replace(/\/+$/, '')
  }
  const remote = gitOptional(['remote', 'get-url', 'origin'])
  if (remote === undefined || remote === '') {
    throw new Error('no repository URL: pass --repo https://github.com/owner/repo, set MARKET_REPO_URL, or add an origin remote')
  }
  return remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '').replace(/\/+$/, '')
}

/** The URL the index will be served at. */
function indexUrl(options) {
  if (typeof options.url === 'string') return options.url
  if (process.env.MARKET_URL !== undefined && process.env.MARKET_URL !== '') {
    return process.env.MARKET_URL.replace(/\/+$/, '') + '/index.json'
  }
  const slug = process.env.GITHUB_REPOSITORY
  if (slug !== undefined && slug !== '') {
    const [owner, name] = slug.split('/')
    return name.toLowerCase() === `${owner.toLowerCase()}.github.io`
      ? `https://${owner}.github.io/index.json`
      : `https://${owner}.github.io/${name}/index.json`
  }
  return 'http://127.0.0.1:8080/index.json'
}

/** Make a `LocalizedText` that satisfies format 1 (`en` present, no blank strings). */
function localized(texts, fallback) {
  const clean = {}
  for (const [language, text] of Object.entries(texts ?? {})) {
    if (typeof text === 'string' && text.trim() !== '') clean[language] = text.trim()
  }
  if (clean.en === undefined) clean.en = (fallback ?? Object.values(clean)[0] ?? '').trim()
  return clean.en === '' ? undefined : clean
}

/** `{ meta: { title, description } }` of every locale file in one package. */
async function localeMetadata(directory) {
  const titles = {}
  const descriptions = {}
  let entries = []
  try {
    entries = await readdir(join(directory, 'locale'))
  } catch {
    return { titles, descriptions }
  }
  for (const entry of entries) {
    const match = /^([a-z0-9-]+)\.json$/i.exec(entry)
    if (match === null) continue
    const parsed = JSON.parse(await readFile(join(directory, 'locale', entry), 'utf8'))
    if (typeof parsed?.meta?.title === 'string') titles[match[1]] = parsed.meta.title
    if (typeof parsed?.meta?.description === 'string') descriptions[match[1]] = parsed.meta.description
  }
  return { titles, descriptions }
}

/** The root `icon.*` file of a package, if any. */
async function iconOf(directory) {
  for (const entry of await readdir(directory)) {
    const match = /^icon\.([a-z0-9]+)$/i.exec(entry)
    if (match === null) continue
    const type = ICON_TYPES[match[1].toLowerCase()]
    if (type === undefined) continue
    return { name: entry, type, contents: await readFile(join(directory, entry)) }
  }
  return undefined
}

/** Build the index document and its static files. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = resolve(root, typeof options.out === 'string' ? options.out : 'public')
  const repoUrl = repositoryUrl(options)
  const url = indexUrl(options)
  const sourceKind = typeof options.source === 'string' ? options.source : (process.env.MARKET_SOURCE ?? 'git')
  if (sourceKind !== 'git' && sourceKind !== 'npm') throw new Error(`--source must be git or npm, got ${JSON.stringify(sourceKind)}`)
  const registryOption = typeof options.registry === 'string' ? options.registry : process.env.MARKET_REGISTRY
  if (sourceKind === 'npm' && (registryOption === undefined || registryOption === '')) {
    throw new Error('--source npm needs --registry https://npm.example/ (or MARKET_REGISTRY)')
  }
  const registry = registryOption === undefined ? undefined : registryOption.replace(/\/+$/, '') + '/'
  const commit = process.env.GITHUB_SHA !== undefined && process.env.GITHUB_SHA !== ''
    ? process.env.GITHUB_SHA
    : (gitOptional(['rev-parse', 'HEAD']) ?? readGitHead())
  if (commit === undefined) throw new Error('cannot resolve the commit to pin: set GITHUB_SHA or run inside a Git checkout')
  const committedAt = Number(process.env.SOURCE_DATE_EPOCH ?? gitOptional(['log', '-1', '--format=%ct', commit]) ?? 0)
    || Math.floor(Date.now() / 1000)
  const official = (process.env.MARKET_OFFICIAL_AUTHORS ?? '').split(',').map((name) => name.trim()).filter(Boolean)
  const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'))

  await rm(outDir, { recursive: true, force: true })
  await mkdir(join(outDir, 'icons'), { recursive: true })

  const plugins = []
  const rows = []
  for (const listed of catalog.plugins ?? []) {
    if (typeof listed.path !== 'string') throw new Error('every catalog entry needs a `path`')
    const directory = resolve(root, listed.path)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const range = manifest.engines?.dsh
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw new Error(`${listed.path}: package.json needs name and version`)
    if (typeof range !== 'string' || range.trim() === '') throw new Error(`${listed.path}: package.json needs engines.dsh`)

    const { titles, descriptions } = await localeMetadata(directory)
    const title = localized(listed.title ?? titles, manifest.name.slice(manifest.name.indexOf('/') + 1))
    const description = localized(listed.description ?? descriptions, manifest.description ?? title.en)

    let icon
    const found = await iconOf(directory)
    if (found !== undefined) {
      if (found.contents.length <= INLINE_ICON_BYTES) {
        icon = `data:${found.type};base64,${found.contents.toString('base64')}`
      } else {
        const file = `${manifest.name.replace(/^@/, '').replace(/[^a-zA-Z0-9._-]+/g, '__')}.${found.name.split('.').pop()}`
        await writeFile(join(outDir, 'icons', file), found.contents)
        icon = `icons/${file}`
      }
    }

    const author = typeof listed.author === 'string' && listed.author !== ''
      ? listed.author
      : (typeof manifest.author === 'string' ? manifest.author : manifest.author?.name)
    const labels = ['unreviewed']
    if (typeof author === 'string' && official.includes(author)) labels.push('official')
    const category = Object.hasOwn(CATEGORIES, listed.category ?? '') ? listed.category : 'other'
    const directoryInsideRepo = relative(root, directory).split('\\').join('/')

    plugins.push({
      name: manifest.name,
      title,
      ...(description === undefined ? {} : { description }),
      ...(icon === undefined ? {} : { icon }),
      ...(typeof author === 'string' ? { author } : {}),
      ...(typeof manifest.homepage === 'string' ? { homepage: manifest.homepage } : {}),
      repository: { url: repoUrl, directory: directoryInsideRepo },
      metadata: { category, labels, keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [], sortKeys: {} },
      versions: [{
        version: manifest.version,
        publishTimestamp: committedAt,
        source: sourceKind === 'npm'
          ? { type: 'npm', registry }
          : { type: 'git', url: repoUrl, commit, path: directoryInsideRepo },
        engines: { dsh: range.trim() },
      }],
    })
    rows.push({ name: manifest.name, version: manifest.version, title: title.zh ?? title.en, category })
  }

  const index = validateIndex({
    format: 1,
    title: catalog.title,
    ...(catalog.description === undefined ? {} : { description: catalog.description }),
    metadata: {
      categories: Object.fromEntries(Object.entries(CATEGORIES).map(([id, text]) => [id, { title: text }])),
      labels: Object.fromEntries(Object.entries(LABELS).map(([id, text]) => [id, { title: text }])),
      sortKeys: {},
    },
    plugins,
  }, url)

  await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  await writeFile(join(outDir, 'index.html'), landingPage({ url, repoUrl, rows, title: catalog.title }))
  await writeFile(join(outDir, '.nojekyll'), '')

  console.log(`index:    ${url}`)
  console.log(`source:   ${repoUrl} @ ${commit}`)
  console.log(`plugins:  ${index.plugins.length}`)
  for (const plugin of index.plugins) {
    console.log(`  ${plugin.name}@${plugin.versions[0].version}  →  ${installSpec(plugin.versions[0].source, plugin.name, plugin.versions[0].version)}`)
  }
  if (index.plugins.length === 0) console.log('  (no plugins listed yet: add packages under plugins/ and entries in catalog.json)')
}

/** The pnpm spec that installs one listed version. */
function installSpec(source, name, version) {
  if (source.type === 'git') {
    const url = source.url.replace(/\.git$/i, '')
    return `git+${url}.git#${source.commit}${source.path === undefined ? '' : `&path:/${source.path}`}`
  }
  return `${name}@${version}`
}

/** A static page that explains what the index is and how to add it. */
function landingPage({ url, repoUrl, rows, title }) {
  const items = rows.map((row) => `<tr><td><code>${row.name}</code></td><td>${row.version}</td><td>${row.title}</td><td>${CATEGORIES[row.category]?.zh ?? row.category}</td></tr>`).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.zh ?? title.en}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 52rem; margin: 3rem auto; padding: 0 1.25rem; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  p.lead { color: #666; margin-top: 0; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  pre { background: #f4f4f5; padding: .75rem 1rem; border-radius: .5rem; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #e5e7eb; }
  th { font-weight: 600; color: #666; }
  ol { padding-left: 1.25rem; }
</style>
<h1>${title.zh ?? title.en}</h1>
<p class="lead">DSH 插件市场索引 · <a href="./index.json">index.json</a> · <a href="${repoUrl}">源码</a></p>

<h2>怎么加进 DSH</h2>
<ol>
  <li>插件页 → <strong>发现</strong> → <strong>管理索引源…</strong></li>
  <li>粘贴 <code>${url}</code></li>
  <li>回到列表，点安装</li>
</ol>

<h2>目录里的插件</h2>
<table>
  <thead><tr><th>包名</th><th>版本</th><th>名称</th><th>分类</th></tr></thead>
  <tbody>
${items || '    <tr><td colspan="4">还没有插件</td></tr>'}
  </tbody>
</table>

<h2>这个索引是什么</h2>
<p>它是一份 <a href="https://github.com/deepseek-ai/deepseek-harness">DSH</a> 的 format 1 插件索引，由 <code>catalog.json</code> 和仓库里的插件包生成；每个版本都锁定到本仓库的一个 commit。</p>
</body>
</html>
`
}

await main()
