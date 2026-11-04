/**
 * Publish one Creator-generated workbench plugin to this Git-hosted market.
 *
 * The Creator writes plugins into `<dsh home>/profiles/<profile>/created-plugins/<pkg>`
 * under the reserved `@dsh-local/...` name. This script runs the same normalization
 * `dsh-market publish` runs, drops the result into `plugins/<slug>`, records it in
 * `catalog.json`, rebuilds the static index in `docs/`, and commits + pushes so the
 * index URL never changes.
 *
 * Usage:
 *   node scripts/publish-plugin.mjs [--dir <path>] [--name @scope/slug] [--version 1.0.0]
 *        [--title "中文名"] [--title-en "English name"] [--description "一句话"]
 *        [--category team|tools|data|productivity|other] [--author "平台组"]
 *        [--dsh ">=0.2.0 <0.3.0"] [--no-push] [--dry-run]
 *
 * With no --dir the newest plugin the Creator generated is used.
 */

import { execFileSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, fallbackTitle, normalize } from '../cli/src/normalize.mjs'
import { findLatestCreatedPlugin } from '../cli/src/paths.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DSH_RANGE = '>=0.2.0 <0.3.0'
const DEFAULT_INDEX_URL = 'https://sy118.github.io/dsh-market/index.json'

/** Parse `--key value` / `--flag` arguments. */
function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) continue
    const key = argument.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      options[key] = true
      continue
    }
    options[key] = value
    index += 1
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const dryRun = options['dry-run'] === true
const push = options['no-push'] !== true && !dryRun

/** Repo web URL derived from the origin remote, or an env override. */
function repositoryUrl() {
  if (typeof options.repo === 'string') return options.repo.replace(/\.git$/, '')
  if (process.env.MARKET_REPO_URL) return process.env.MARKET_REPO_URL.replace(/\.git$/, '')
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
    return remote
      .replace(/^git@([^:]+):/, 'https://$1/')
      .replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/')
      .replace(/\.git$/, '')
  } catch {
    throw new Error('cannot read origin remote; pass --repo https://github.com/owner/repo')
  }
}

/** The index URL people add in Discover. */
function indexUrl() {
  if (typeof options.url === 'string') return options.url
  if (process.env.MARKET_INDEX_URL) return process.env.MARKET_INDEX_URL
  return DEFAULT_INDEX_URL
}

/** Source directory: --dir, else the newest plugin the Creator generated. */
async function sourceDir() {
  if (typeof options.dir === 'string') {
    const candidates = [resolve(process.cwd(), options.dir), resolve(root, options.dir)]
    for (const dir of candidates) {
      try {
        await readFile(join(dir, 'package.json'), 'utf8')
        return dir
      } catch {}
    }
    throw new Error(`no package.json under ${options.dir}`)
  }
  const latest = await findLatestCreatedPlugin()
  if (latest === undefined) {
    throw new Error('no Creator-generated plugin found: run the Creator in DSH first, or pass --dir <path>')
  }
  console.log(`source:  ${latest.dir} (profile ${latest.profile})`)
  return latest.dir
}

/** `plugins/dir-name` derived from the target package name. */
function slugOf(name) {
  return name.slice(name.indexOf('/') + 1)
}

/** Insert or replace one entry in catalog.json. */
async function recordInCatalog({ slug, title, titleEn, description, category }) {
  const file = join(root, 'catalog.json')
  const catalog = JSON.parse(await readFile(file, 'utf8'))
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : []
  const path = `plugins/${slug}`
  const entry = {
    path,
    category,
    title: titleEn === title ? { zh: title, en: title } : { zh: title, en: titleEn },
    ...(description ? { description: { zh: description, en: description } } : {}),
  }
  const at = plugins.findIndex((listed) => listed.path === path)
  if (at >= 0) plugins[at] = entry
  else plugins.push(entry)
  catalog.plugins = plugins
  return { file, catalog }
}

const dir = await sourceDir()
const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
const dirSlug = basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
const title = typeof options.title === 'string' ? options.title : fallbackTitle(dirSlug)
const titleEn = typeof options['title-en'] === 'string' ? options['title-en'] : title
const name = typeof options.name === 'string' ? options.name : `@acme-community/${dirSlug}`
const version = typeof options.version === 'string' ? options.version : String(manifest.version ?? '1.0.0')
const category = typeof options.category === 'string' ? options.category : 'other'
const description = typeof options.description === 'string' ? options.description : undefined
const author = { name: typeof options.author === 'string' ? options.author : '平台组' }
const dshRange = typeof options.dsh === 'string' ? options.dsh : DEFAULT_DSH_RANGE

if (!Object.hasOwn(CATEGORIES, category)) {
  throw new Error(`--category must be one of: ${Object.keys(CATEGORIES).join(', ')}`)
}

const slug = slugOf(name)
const target = join(root, 'plugins', slug)

if (dryRun) {
  console.log(`would publish ${name}@${version} → ${target}`)
  process.exit(0)
}

await rm(target, { recursive: true, force: true })
const normalized = await normalize({
  sourceDir: dir,
  stagingDir: target,
  name,
  version,
  title,
  description: description ?? `${title}`,
  category,
  dshRange,
  author,
})
console.log(`normalized ${normalized.oldName} → ${normalized.name}@${normalized.version} (${target})`)

const { file: catalogFile, catalog } = await recordInCatalog({ slug, title, titleEn, description, category })
await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`catalog: catalog.json now lists ${String(catalog.plugins.length)} plugin(s)`)

execFileSync(process.execPath, ['scripts/build-static-index.mjs', '--out', 'docs', '--repo', repositoryUrl(), '--url', indexUrl()], {
  cwd: root,
  stdio: 'inherit',
})

if (!push) {
  console.log('done (not pushed): review `git status`, then commit and push yourself')
  process.exit(0)
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
git('add', '--', `plugins/${slug}`, 'catalog.json', 'docs')
git(
  '-c', 'user.name=dsh-market', '-c', 'user.email=dsh-market@local',
  'commit', '-q', '-m', `plugin: ${normalized.name}@${normalized.version}`,
  '-m', `${title} — ${description ?? title}`,
)
console.log(`committed: ${git('log', '-1', '--format=%h %s').trim()}`)

let lastError
for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    git('push', 'origin', 'HEAD:main')
    console.log(`pushed on attempt ${String(attempt)}`)
    lastError = undefined
    break
  } catch (error) {
    lastError = error
    console.log(`push attempt ${String(attempt)} failed, retrying…`)
  }
}
if (lastError !== undefined) throw lastError

console.log(`\nlive at: ${indexUrl()}`)
console.log('colleagues: Discover → refresh (or add the index source if they have not)')
