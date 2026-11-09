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
 *        [--dsh ">=0.2.0 <0.3.0"]
 *        [--npm --registry https://npm.acme.internal/]   publish the package to that
 *                                                        registry and point the index
 *                                                        at it instead of a Git commit
 *        [--no-push] [--dry-run]
 *
 * With no --dir the newest plugin the Creator generated is used.
 */

import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
const npmMode = options.npm === true || typeof options.registry === 'string'
const registry = typeof options.registry === 'string'
  ? options.registry.replace(/\/+$/, '') + '/'
  : (process.env.MARKET_REGISTRY === undefined ? undefined : process.env.MARKET_REGISTRY.replace(/\/+$/, '') + '/')
if (npmMode && registry === undefined) {
  throw new Error('--npm needs --registry https://npm.acme.internal/ (or MARKET_REGISTRY)')
}

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

// Normalize into a private staging directory before touching the target. `--dir` may be
// `plugins/<slug>` itself when re-publishing a new version of an existing plugin, so the
// target must never be removed before the source has been read.
const staging = await mkdtemp(join(tmpdir(), 'dsh-market-publish-'))
let normalized
try {
  normalized = await normalize({
    sourceDir: dir,
    stagingDir: staging,
    name,
    version,
    title,
    description: description ?? `${title}`,
    category,
    dshRange,
    author,
  })
  await rm(target, { recursive: true, force: true })
  await cp(staging, target, { recursive: true })
} finally {
  await rm(staging, { recursive: true, force: true })
}
console.log(`normalized ${normalized.oldName} → ${normalized.name}@${normalized.version} (${target})`)

const { file: catalogFile, catalog } = await recordInCatalog({ slug, title, titleEn, description, category })
await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`catalog: catalog.json now lists ${String(catalog.plugins.length)} plugin(s)`)

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// Commit the package first: a Git-sourced index pins every version to a commit,
// and that commit has to be one in which the plugin directory already exists.
git('add', '--', `plugins/${slug}`, 'catalog.json')
git(
  '-c', 'user.name=dsh-market', '-c', 'user.email=dsh-market@local',
  'commit', '-q', '-m', `plugin: ${normalized.name}@${normalized.version}`,
  '-m', `${title} — ${description ?? title}`,
)
const pinned = git('rev-parse', 'HEAD').trim()
console.log(`committed plugin files: ${git('log', '-1', '--format=%h %s').trim()}`)

if (npmMode) {
  console.log(`npm publish → ${registry}`)
  try {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['publish', '--registry', registry], {
      cwd: target,
      stdio: 'inherit',
    })
  } catch {
    throw new Error(`npm publish failed — log in once with: npm login --registry ${registry}`)
  }
}

const buildArgs = ['scripts/build-static-index.mjs', '--out', 'docs', '--repo', repositoryUrl(), '--url', indexUrl()]
if (npmMode) buildArgs.push('--source', 'npm', '--registry', registry)
execFileSync(process.execPath, buildArgs, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, GITHUB_SHA: pinned },
})

git('add', '--', 'docs')
git(
  '-c', 'user.name=dsh-market', '-c', 'user.email=dsh-market@local',
  'commit', '-q', '-m', `index: rebuild for ${normalized.name}@${normalized.version}`,
  '-m', `Pins every version to ${pinned.slice(0, 12)}.`,
)
console.log(`committed index: ${git('log', '-1', '--format=%h %s').trim()}`)

if (!push) {
  console.log('done (not pushed): review `git status`, then push yourself')
  process.exit(0)
}

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
