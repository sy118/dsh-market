/**
 * Turn a plugin the Creator generated inside one profile into a publishable
 * package: rename it out of the reserved namespace, declare what the market
 * needs, and add the display metadata the generator does not produce.
 *
 * The transformation is a plain text replacement of the old package name plus
 * a manifest rewrite. The old name embeds a UUID, so the replacement cannot
 * collide with unrelated text.
 */

import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Directories that never belong in a published plugin. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.dsh-created-plugins', '.plugin-manager'])
/** Files a desktop sometimes leaves behind. */
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])
/** Extensions treated as text when rewriting the package name. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.html', '.css', '.ts', '.tsx', '.jsx', '.txt', '.svg'])
const MAX_TEXT_BYTES = 2 * 1024 * 1024

/** Category ids the market declares; keep in sync with the index service. */
export const CATEGORIES = {
  team: { zh: '团队协作', en: 'Team' },
  tools: { zh: '内部系统', en: 'Internal tools' },
  data: { zh: '数据与报表', en: 'Data and reports' },
  productivity: { zh: '效率工具', en: 'Productivity' },
  other: { zh: '其他', en: 'Other' },
}

const DEFAULT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Workbench plugin">
  <rect x="4" y="4" width="56" height="56" rx="14" fill="#1f2937"/>
  <rect x="14" y="16" width="36" height="7" rx="3.5" fill="#e5e7eb"/>
  <rect x="14" y="29" width="22" height="7" rx="3.5" fill="#9ca3af"/>
  <rect x="14" y="42" width="30" height="7" rx="3.5" fill="#6b7280"/>
</svg>
`

/** npm's rules for a new package name: lowercase, no leading dot or underscore. */
const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/

/** Recursively list files, skipping what never ships. */
async function walk(directory, root = directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      await walk(join(directory, entry.name), root, files)
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
      files.push(join(directory, entry.name))
    }
  }
  return files
}

/** Whether a buffer looks like text (no NUL byte) and is small enough to rewrite. */
function readableText(buffer) {
  if (buffer.length > MAX_TEXT_BYTES) return false
  const sample = buffer.subarray(0, 4096)
  return !sample.includes(0)
}

/** Replace every occurrence of the old package name in text files. */
async function renamePackage(staging, oldName, newName) {
  let changed = 0
  for (const file of await walk(staging)) {
    const extension = file.slice(file.lastIndexOf('.')).toLowerCase()
    if (!TEXT_EXTENSIONS.has(extension) && !file.endsWith('cordis.patch.yml')) continue
    const buffer = await readFile(file)
    if (!readableText(buffer)) continue
    const text = buffer.toString('utf8')
    if (!text.includes(oldName)) continue
    await writeFile(file, text.split(oldName).join(newName))
    changed += 1
  }
  return changed
}

/** Write a locale file, keeping any `meta` fields already present. */
async function writeLocale(staging, language, title, description) {
  const path = join(staging, 'locale', `${language}.json`)
  let existing = {}
  try {
    existing = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const meta = typeof existing.meta === 'object' && existing.meta !== null ? existing.meta : {}
  meta.title = typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title : title
  meta.description = typeof meta.description === 'string' && meta.description.trim() !== '' ? meta.description : description
  await mkdir(join(staging, 'locale'), { recursive: true })
  await writeFile(path, `${JSON.stringify({ ...existing, meta }, null, 2)}\n`)
}

/** Find the root icon file, if the generated package already has one. */
async function existingIcon(staging) {
  const entries = await readdir(staging, { withFileTypes: true })
  return entries.find((entry) => entry.isFile() && /^icon\.(svg|png|jpe?g|webp)$/i.test(entry.name))?.name
}

/** A README for a generated package that has none. */
function readmeText({ title, description, category }) {
  return `# ${title}

${description}

## 它做什么

这是一个在 DSH 里创建的"工作台"插件：装在插件页提供的入口里，卸载时只移除自己的界面。

分类：${CATEGORIES[category]?.zh ?? CATEGORIES.other.zh}

## 数据与权限

- 数据保存在你自己的 DSH 配置中，插件包里不含个人数据。
- 本插件以你的 DSH 权限运行，请只从公司市场安装。

## 由谁维护

在公司插件市场提交发布的人。发现问题请先联系作者，或在插件市场下架该插件。
`
}

/**
 * Normalize a generated plugin into a publishable one.
 * @param {object} options - transformation inputs.
 * @param {string} options.sourceDir - the generated package directory.
 * @param {string} options.stagingDir - empty directory to write the result into.
 * @param {string} options.name - target package name, `@scope/slug`.
 * @param {string} options.version - exact version to publish.
 * @param {string} options.title - display title.
 * @param {string} options.description - one-line description.
 * @param {string} options.category - category id from {@link CATEGORIES}.
 * @param {string} options.dshRange - `engines.dsh` range this deployment supports.
 * @param {{ name: string }} options.author - who publishes it.
 * @returns {Promise<{ oldName: string, name: string, version: string, renamedFiles: number }>} what changed.
 * @throws {Error} when the source is not a generated bundle or the target name is invalid.
 */
export async function normalize(options) {
  const { sourceDir, stagingDir, name, version, title, description, category, dshRange, author } = options
  if (!PACKAGE_NAME.test(name)) throw new Error(`invalid package name ${JSON.stringify(name)}; expected @scope/slug in lowercase`)
  if (!Object.hasOwn(CATEGORIES, category)) throw new Error(`unknown category ${JSON.stringify(category)}; use one of ${Object.keys(CATEGORIES).join(', ')}`)

  await mkdir(stagingDir, { recursive: true })
  await cp(sourceDir, stagingDir, {
    recursive: true,
    filter: (source) => !SKIP_DIRECTORIES.has(basename(source)) && !SKIP_FILES.has(basename(source)),
  })

  const manifestPath = join(stagingDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (typeof manifest.name !== 'string' || typeof manifest.dsh?.bundle?.patch !== 'string') {
    throw new Error('not a DSH bundle: package.json needs `dsh.bundle.patch`')
  }
  const oldName = manifest.name
  if (oldName === name) throw new Error(`the package is already named ${name}; publish a new version instead`)

  const renamedFiles = await renamePackage(stagingDir, oldName, name)

  delete manifest.private
  delete manifest.scripts
  delete manifest.devDependencies
  manifest.name = name
  manifest.version = version
  manifest.description = description
  manifest.author = { name: author.name }
  manifest.license = typeof manifest.license === 'string' ? manifest.license : 'UNLICENSED'
  manifest.engines = { ...(typeof manifest.engines === 'object' ? manifest.engines : {}), dsh: dshRange }
  manifest.dshMarket = { category }
  manifest.keywords = [...new Set([
    ...(Array.isArray(manifest.keywords) ? manifest.keywords.filter((keyword) => typeof keyword === 'string') : []),
    category,
  ])]
  if (typeof manifest.main !== 'string' && typeof manifest.exports !== 'object') manifest.main = './index.js'

  const iconName = await existingIcon(stagingDir)
  if (iconName === undefined) {
    await writeFile(join(stagingDir, 'icon.svg'), DEFAULT_ICON)
  }
  const iconFile = iconName ?? 'icon.svg'

  await writeLocale(stagingDir, 'zh', title, description)
  await writeLocale(stagingDir, 'en', title, description)

  if (typeof manifest.exports === 'object' && manifest.exports !== null && !Array.isArray(manifest.exports)) {
    manifest.exports = {
      ...manifest.exports,
      './locale/*.json': './locale/*.json',
      './icon': `./${iconFile}`,
    }
  } else if (typeof manifest.exports === 'string') {
    manifest.exports = { '.': manifest.exports, './locale/*.json': './locale/*.json', './icon': `./${iconFile}` }
  }

  if (!(await fileExists(join(stagingDir, 'README.md')))) {
    await writeFile(join(stagingDir, 'README.md'), readmeText({ title, description, category }))
  }

  const topLevel = (await readdir(stagingDir, { withFileTypes: true }))
    .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
    .map((entry) => entry.name)
  manifest.files = topLevel

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { oldName, name, version, renamedFiles }
}

/** Whether a path exists. */
async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** Describe the text a deployment should show when `title` is absent. */
export function fallbackTitle(slug) {
  const base = slug.replace(/[._-]+/g, ' ').trim()
  return base === '' ? slug : base.charAt(0).toUpperCase() + base.slice(1)
}
