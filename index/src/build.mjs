/**
 * Assemble a DSH plugin market index (format 1) from a Verdaccio storage
 * directory, and validate it with the same parser DSH itself uses.
 */

import { readFile, stat } from 'node:fs/promises'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { readPackages, tarballFiles, tarballOf } from './registry.mjs'
import { packageFiles, readTarGz } from './tar.mjs'

/** Category ids the index declares; a package naming another id falls back to `other`. */
export const CATEGORIES = {
  team: { zh: '团队协作', en: 'Team' },
  tools: { zh: '内部系统', en: 'Internal tools' },
  data: { zh: '数据与报表', en: 'Data and reports' },
  productivity: { zh: '效率工具', en: 'Productivity' },
  other: { zh: '其他', en: 'Other' },
}

/** Label ids the index declares. */
export const LABELS = {
  unreviewed: { zh: '未审核', en: 'Unreviewed' },
  official: { zh: '官方', en: 'Official' },
}

const ICON_TYPES = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** Inline payload limit of format 1; larger icons are served from `/icons/`. */
const INLINE_ICON_BYTES = 32 * 1024
/** Installed-plugin icon limit, mirrored here so oversized icons are rejected early. */
const MAX_ICON_BYTES = 256 * 1024

/** Parse a version's numeric core and prerelease tags for ordering. */
function versionParts(version) {
  const [core, prerelease = ''] = String(version).split('+')[0].split('-', 2)
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0)
  return { numbers, prerelease: prerelease === '' ? [] : prerelease.split('.') }
}

/** SemVer precedence, newest first when used as a descending comparator. */
export function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const one = a.prerelease[index]
    const other = b.prerelease[index]
    if (one === undefined) return -1
    if (other === undefined) return 1
    const oneNumber = /^\d+$/.test(one)
    const otherNumber = /^\d+$/.test(other)
    if (oneNumber && otherNumber) {
      const difference = Number(one) - Number(other)
      if (difference !== 0) return difference
    } else if (oneNumber !== otherNumber) {
      return oneNumber ? -1 : 1
    } else if (one !== other) {
      return one < other ? -1 : 1
    }
  }
  return 0
}

/** A version range the index can list; the validator checks its grammar. */
function usableRange(engines) {
  const range = engines?.dsh
  return typeof range === 'string' && range.trim() !== '' ? range.trim() : undefined
}

/**
 * Validate a candidate index with the same parser DSH itself uses.
 * @param {object} value - the document to validate.
 * @param {string} indexUrl - URL the document is served at, used to resolve relative icons.
 * @returns {object} the validated index.
 */
export function validateIndex(value, indexUrl) {
  return parseMarketIndex(value, indexUrl)
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

/** `demo-board` → `Demo board`, the last-resort title of a package with no locale metadata. */
function humanize(name) {
  const base = name.slice(name.indexOf('/') + 1).replace(/[._-]+/g, ' ').trim()
  return base === '' ? name : base.charAt(0).toUpperCase() + base.slice(1)
}

/** Read `{ meta: { title, description } }` out of the package's locale files. */
function localeMetadata(files) {
  const titles = {}
  const descriptions = {}
  for (const [path, contents] of files) {
    const match = /^locale\/([a-z0-9-]+)\.json$/i.exec(path)
    if (match === null) continue
    let parsed
    try {
      parsed = JSON.parse(contents.toString('utf8'))
    } catch {
      continue
    }
    const meta = parsed?.meta
    if (typeof meta?.title === 'string') titles[match[1]] = meta.title
    if (typeof meta?.description === 'string') descriptions[match[1]] = meta.description
  }
  return { titles, descriptions }
}

/** The largest root-level `icon.*` file, with the MIME type its extension names. */
function iconOf(files) {
  for (const [path, contents] of files) {
    const match = /^icon\.([a-z0-9]+)$/i.exec(path)
    if (match === null) continue
    const type = ICON_TYPES[match[1].toLowerCase()]
    if (type === undefined || contents.length > MAX_ICON_BYTES) continue
    return { contents, type, extension: match[1].toLowerCase() }
  }
  return undefined
}

/** Normalize an npm repository declaration into format 1's `{ url, directory? }`. */
function repositoryOf(manifest) {
  const declared = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  const directory = typeof manifest.repository === 'object' && manifest.repository !== null ? manifest.repository.directory : undefined
  if (typeof declared !== 'string') return undefined
  const stripped = declared.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/i, '')
  let url
  try {
    url = new URL(stripped)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  const web = url.toString().replace(/\/+$/, '')
  if ([...url.pathname.split('/')].filter((segment) => segment !== '').length < 2) return undefined
  const safeDirectory = typeof directory === 'string' && /^[A-Za-z0-9._@+\-/]+$/.test(directory) && !directory.split('/').includes('..')
    ? directory
    : undefined
  return safeDirectory === undefined ? { url: web } : { url: web, directory: safeDirectory }
}

/** The author name npm declares, as one display string. */
function authorOf(manifest, packument) {
  const declared = manifest.author
  const name = typeof declared === 'string' ? declared.replace(/\s*<[^>]*>.*$/, '').trim() : declared?.name
  if (typeof name === 'string' && name.trim() !== '') return name.trim()
  const maintainer = packument.maintainers?.[0]?.name
  return typeof maintainer === 'string' && maintainer.trim() !== '' ? maintainer.trim() : undefined
}

/** A filesystem-safe icon file name, unique per package. */
function iconFileName(name, extension) {
  return `${name.replace(/^@/, '').replace(/[^a-zA-Z0-9._-]+/g, '__')}.${extension}`
}

/** Read locale and icon metadata out of one tarball, cached by file stat. */
async function displayOf(tarballPath, cache) {
  const info = await stat(tarballPath)
  const cached = cache.get(tarballPath)
  if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.display
  const files = packageFiles(readTarGz(await readFile(tarballPath)))
  const display = { locales: localeMetadata(files), icon: iconOf(files) }
  cache.set(tarballPath, { mtimeMs: info.mtimeMs, size: info.size, display })
  return display
}

/** One plugin's index entry, or undefined when it has no listable version. */
async function pluginEntry(pkg, config, cache, icons) {
  const versions = Object.entries(pkg.packument.versions)
    .map(([version, manifest]) => ({ version, manifest }))
    .filter(({ manifest }) => usableRange(manifest.engines) !== undefined)
    .sort((left, right) => compareVersions(right.version, left.version))
    .slice(0, config.maxVersions)
  if (versions.length === 0) return undefined

  const files = await tarballFiles(pkg.dir)
  const listed = []
  for (const { version, manifest } of versions) {
    const tarball = tarballOf(pkg.dir, pkg.name, version, files)
    if (tarball === undefined) continue
    listed.push({
      version,
      publishTimestamp: Math.max(0, Math.floor(Date.parse(pkg.packument.time?.[version] ?? '') / 1000) || 0),
      source: { type: 'npm', registry: config.registryUrl },
      engines: { dsh: usableRange(manifest.engines) },
      tarball,
      manifest,
    })
  }
  if (listed.length === 0) return undefined

  const newest = listed[0]
  const display = await displayOf(newest.tarball, cache)
  const { titles, descriptions } = display.locales
  const title = localized(titles, humanize(pkg.name))
  if (title === undefined) return undefined

  let icon
  if (display.icon !== undefined) {
    icon = display.icon.contents.length <= INLINE_ICON_BYTES
      ? `data:${display.icon.type};base64,${display.icon.contents.toString('base64')}`
      : (() => {
        const file = iconFileName(pkg.name, display.icon.extension)
        icons.set(file, { contents: display.icon.contents, type: display.icon.type })
        return `icons/${file}`
      })()
  }

  const author = authorOf(newest.manifest, pkg.packument)
  const category = Object.hasOwn(CATEGORIES, newest.manifest.dshMarket?.category ?? '') ? newest.manifest.dshMarket.category : 'other'
  const labels = ['unreviewed']
  if (author !== undefined && config.officialAuthors.includes(author)) labels.push('official')
  const keywords = Array.isArray(newest.manifest.keywords)
    ? newest.manifest.keywords.filter((keyword) => typeof keyword === 'string' && keyword.trim() !== '').slice(0, 20)
    : []

  return {
    entry: {
      name: pkg.name,
      title,
      ...(() => {
        const description = localized(descriptions, typeof newest.manifest.description === 'string' ? newest.manifest.description : title.en)
        return description === undefined ? {} : { description }
      })(),
      ...(icon === undefined ? {} : { icon }),
      ...(author === undefined ? {} : { author }),
      ...(typeof newest.manifest.homepage === 'string' && /^https?:\/\//i.test(newest.manifest.homepage)
        ? { homepage: newest.manifest.homepage }
        : {}),
      ...(() => {
        const repository = repositoryOf(newest.manifest)
        return repository === undefined ? {} : { repository }
      })(),
      metadata: { category, keywords, labels, sortKeys: {} },
      versions: listed.map(({ version, publishTimestamp, source, engines }) => ({ version, publishTimestamp, source, engines })),
    },
    timestamp: Math.max(...listed.map((version) => version.publishTimestamp)),
  }
}

/**
 * Build and validate the index.
 * @param {ReturnType<import('./config.mjs').loadConfig>} config - service configuration.
 * @param {Map<string, object>} cache - tarball metadata cache, reused across polls.
 * @param {Set<string>} blocklist - package names kept out of the index.
 * @returns {Promise<{ index: object, icons: Map<string, { contents: Buffer, type: string }>, skipped: string[] }>} the validated index.
 */
export async function buildMarket(config, cache, blocklist) {
  const packages = (await readPackages(config.storageDir, config.scope))
    .filter((pkg) => !blocklist.has(pkg.name))
  const icons = new Map()
  const skipped = []
  const entries = []

  for (const pkg of packages) {
    try {
      const built = await pluginEntry(pkg, config, cache, icons)
      if (built !== undefined) entries.push(built)
    } catch (error) {
      skipped.push(`${pkg.name}: ${error.message}`)
    }
  }
  entries.sort((left, right) => right.timestamp - left.timestamp)

  const base = {
    format: 1,
    title: config.title,
    description: config.description,
    metadata: {
      categories: Object.fromEntries(Object.entries(CATEGORIES).map(([id, title]) => [id, { title }])),
      labels: Object.fromEntries(Object.entries(LABELS).map(([id, title]) => [id, { title }])),
      sortKeys: {},
    },
    plugins: entries.map((entry) => entry.entry),
  }

  // A package that the format rejects must not take the whole index down: drop
  // it, remember why, and validate again.
  let candidate = base
  const indexUrl = `${config.publicBaseUrl}/index.json`
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    try {
      return { index: parseMarketIndex(candidate, indexUrl), icons, skipped }
    } catch (error) {
      const match = /^\$\.plugins\[(\d+)\]/.exec(error?.path ?? '')
      if (match === null) throw error
      const dropped = candidate.plugins[Number(match[1])]
      skipped.push(`${dropped?.name ?? 'unknown'}: ${error.reason ?? error.message}`)
      candidate = { ...candidate, plugins: candidate.plugins.filter((plugin) => plugin !== dropped) }
    }
  }
  return { index: parseMarketIndex(candidate, indexUrl), icons, skipped }
}
