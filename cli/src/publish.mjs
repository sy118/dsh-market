/**
 * `dsh-market publish`: normalize a generated plugin, run the publish gates,
 * pack it, and upload it to the market's registry.
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadConfig } from './config.mjs'
import { CATEGORIES, fallbackTitle, normalize } from './normalize.mjs'
import { findLatestCreatedPlugin } from './paths.mjs'
import { dedupe, scanPackage } from './scan.mjs'
import { readTarGz } from './tar.mjs'
import { ask, choose, confirm, isInteractive, line } from './ui.mjs'

/** Publishing limits; a package over any of them is refused before upload. */
const LIMITS = {
  tarballBytes: 5 * 1024 * 1024,
  files: 300,
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** Quote one argument for a `cmd.exe` command line. */
function quote(argument) {
  return /[\s"&|<>^]/.test(argument) ? `"${argument.replace(/"/g, '')}"` : argument
}

/** Run a command, returning its output instead of streaming it. */
function run(command, args, cwd) {
  const executable = process.env.DSH_MARKET_PNPM ?? command
  const options = {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: '1' },
  }
  // Windows needs a shell to launch `pnpm.cmd`; passing the whole line as the
  // command keeps Node from warning about arguments next to `shell: true`.
  const invoke = process.platform === 'win32'
    ? () => spawnSync([executable, ...args.map(quote)].join(' '), { ...options, shell: true })
    : () => spawnSync(executable, args, options)
  let result = invoke()
  if (result.error?.code === 'EPERM') {
    // A sandbox that forbids piped stdio (the Harness can run this CLI inside
    // one) still allows an inherited terminal, so retry without capturing.
    const inherited = process.platform === 'win32'
      ? spawnSync([executable, ...args.map(quote)].join(' '), { ...options, shell: true, stdio: 'inherit' })
      : spawnSync(executable, args, { ...options, stdio: 'inherit' })
    return { status: inherited.status ?? 1, stdout: '', stderr: '', uncaptured: true }
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  }
}

/** Package manager publish uses: pnpm when present, otherwise the npm that ships with Node. */
function packageManager() {
  if (typeof process.env.DSH_MARKET_PM === 'string' && process.env.DSH_MARKET_PM !== '') return process.env.DSH_MARKET_PM
  for (const candidate of ['pnpm', 'npm']) {
    if (run(candidate, ['--version'], process.cwd()).status === 0) return candidate
  }
  return 'pnpm'
}

/** The author identity to publish under. */
async function resolveAuthor(config) {
  if (typeof config.author?.name === 'string' && config.author.name !== '') return config.author
  const name = run('git', ['config', 'user.name']).stdout.trim()
  const email = run('git', ['config', 'user.email']).stdout.trim()
  if (name !== '') return email === '' ? { name } : { name, email }
  const fallback = process.env.USERNAME ?? process.env.USER ?? 'unknown'
  return { name: fallback }
}

/** Expand a bare slug into the configured scope. */
function expandName(name, scope) {
  return name.startsWith('@') ? name : `${scope}/${name}`
}

/** Human-readable size. */
function size(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

/** Print the gate results and decide whether publishing may continue. */
async function gate({ scan, tarballBytes, entries }) {
  const findings = dedupe(scan.findings)
  const blocked = findings.filter((finding) => finding.severity === 'block')
  const warned = findings.filter((finding) => finding.severity === 'warn')

  line(`Files: ${scan.files}, source ${size(scan.bytes)}`)
  for (const finding of [...blocked, ...warned].slice(0, 20)) {
    const where = finding.line === 0 ? finding.file : `${finding.file}:${finding.line}`
    line(`  ${finding.severity === 'block' ? 'BLOCK' : 'warn '} ${where}  ${finding.message}${finding.excerpt === undefined ? '' : ` — ${finding.excerpt}`}`)
  }
  if (findings.length > 20) line(`  … ${findings.length - 20} more finding(s)`)

  if (blocked.length > 0) {
    line('Publish stopped: remove the blocked items above, then run again.')
    return { ok: false, reason: 'blocked' }
  }
  if (tarballBytes > LIMITS.tarballBytes) {
    line(`Publish stopped: the package is ${size(tarballBytes)}, over the ${size(LIMITS.tarballBytes)} limit.`)
    return { ok: false, reason: 'too-large' }
  }
  if (entries > LIMITS.files) {
    line(`Publish stopped: ${entries} files, over the ${LIMITS.files}-file limit.`)
    return { ok: false, reason: 'too-many-files' }
  }
  return { ok: true, warned: warned.length }
}

/**
 * Publish one plugin.
 * @param {object} options - command options.
 * @param {string} [options.dir] - generated plugin directory; defaults to the newest one.
 * @param {string} [options.name] - target package name, `slug` or `@scope/slug`.
 * @param {string} [options.title] - display title.
 * @param {string} [options.description] - one-line description.
 * @param {string} [options.category] - category id.
 * @param {string} [options.version] - exact version.
 * @param {string} [options.registry] - registry URL.
 * @param {string} [options.dshRange] - `engines.dsh` range to declare.
 * @param {boolean} [options.dryRun] - stop before uploading.
 * @param {boolean} [options.yes] - accept warnings without asking.
 * @returns {Promise<number>} process exit code.
 */
export async function publish(options) {
  const config = await loadConfig()
  const registry = options.registry ?? config.registry
  if (registry === undefined) {
    line('No registry configured. Run `dsh-market login --registry https://npm.example.internal/` first.')
    return 1
  }

  const target = options.dir === undefined
    ? await findLatestCreatedPlugin()
    : { dir: resolve(options.dir), profile: '(given)' }
  if (target === undefined) {
    line('No generated plugin found under $DSH_HOME/profiles/*/created-plugins.')
    line('Create one in DSH first (Plugins → Create your plugin), or pass a directory.')
    return 1
  }

  const manifest = JSON.parse(await readFile(join(target.dir, 'package.json'), 'utf8'))
  if (typeof manifest.dsh?.bundle?.patch !== 'string') {
    line(`${target.dir} is not a DSH bundle (package.json has no dsh.bundle.patch).`)
    return 1
  }

  const bare = String(manifest.name ?? '').includes('/') ? String(manifest.name).slice(String(manifest.name).indexOf('/') + 1) : 'plugin'
  const suggested = `@${(config.scope ?? '@acme-community').replace(/^@/, '')}/${bare.replace(/^view-/, 'plugin-').slice(0, 40)}`

  let name = options.name ?? (isInteractive() ? await ask('Package name', suggested) : undefined)
  if (name === undefined) {
    line('Pass --name <slug> (or @scope/slug) when not running in a terminal.')
    return 1
  }
  name = expandName(name, config.scope ?? '@acme-community')

  const title = options.title ?? (isInteractive() ? await ask('Title', fallbackTitle(name.slice(name.indexOf('/') + 1))) : undefined)
  if (title === undefined || title.trim() === '') {
    line('Pass --title "…" when not running in a terminal.')
    return 1
  }

  const existingDescription = typeof manifest.description === 'string' ? manifest.description : ''
  let description = options.description ?? existingDescription
  if (description === '' && isInteractive()) description = await ask('One-line description')
  if (description === '') {
    line('Pass --description "…": the market card needs one line.')
    return 1
  }

  const category = options.category
    ?? (isInteractive()
      ? await choose('Category', Object.entries(CATEGORIES).map(([value, text]) => ({ value, label: text.zh })))
      : 'other')
  const version = options.version ?? (typeof manifest.version === 'string' && VERSION.test(manifest.version) ? manifest.version : '1.0.0')
  if (!VERSION.test(version)) {
    line(`Invalid version ${version}; expected something like 1.0.0.`)
    return 1
  }

  line('')
  line(`Source      ${target.dir}  (profile ${target.profile})`)
  line(`Package     ${name}@${version}`)
  line(`Registry    ${registry}`)
  line(`Category    ${CATEGORIES[category]?.zh ?? category}`)
  line(`Engines     dsh ${options.dshRange ?? config.dshRange}`)
  line('')

  const staging = await mkdtemp(join(tmpdir(), 'dsh-market-'))
  try {
    const normalized = await normalize({
      sourceDir: target.dir,
      stagingDir: staging,
      name,
      version,
      title,
      description,
      category,
      dshRange: options.dshRange ?? config.dshRange,
      author: await resolveAuthor(config),
    })
    line(`Renamed ${normalized.oldName} → ${name} in ${normalized.renamedFiles} file(s).`)

    const scan = await scanPackage(staging)
    const packDir = await mkdtemp(join(tmpdir(), 'dsh-market-pack-'))
    const manager = packageManager()
    try {
      const packed = run(manager, ['pack', '--pack-destination', packDir], staging)
      if (packed.status !== 0) {
        line(`${manager} pack failed:`)
        line((packed.stderr || packed.stdout).trim())
        return 1
      }
      const archive = (await readdir(packDir)).find((file) => file.endsWith('.tgz'))
      if (archive === undefined) {
        line(`${manager} pack produced no tarball.`)
        return 1
      }
      const tarball = await readFile(join(packDir, archive))
      const entries = [...readTarGz(tarball).keys()].map((path) => path.replace(/^package\//, ''))
      const verdict = await gate({ scan, tarballBytes: tarball.length, entries: entries.length })
      line(`Tarball: ${archive}  ${size(tarball.length)}  ${entries.length} entries`)
      for (const entry of entries.slice(0, 40)) line(`  ${entry}`)
      if (entries.length > 40) line(`  … ${entries.length - 40} more`)

      if (!verdict.ok) return 1
      if (verdict.warned > 0 && !options.yes && !options.dryRun) {
        if (!isInteractive() || !(await confirm(`${verdict.warned} warning(s) above. Publish anyway?`))) {
          line('Publish cancelled. Fix the warnings or pass --yes.')
          return 1
        }
      }
      if (options.dryRun) {
        line('')
        line('Dry run: nothing was uploaded.')
        return 0
      }

      line('')
      line(`Publishing to ${registry} …`)
      const publishArgs = manager === 'npm'
        ? ['publish', '--registry', registry, '--access', 'public']
        : ['publish', '--registry', registry, '--no-git-checks', '--access', 'public']
      const published = run(manager, publishArgs, staging)
      if (published.status !== 0) {
        const output = `${published.stderr}\n${published.stdout}`
        line(`${manager} publish failed:`)
        line(output.trim())
        if (/E401|ENEEDAUTH|unauthor/i.test(output)) line('Run `dsh-market login` again; the registry rejected the token.')
        if (/EPUBLISHCONFLICT|cannot publish over|previously published/i.test(output)) {
          line(`Version ${version} already exists. Publish ${version} with a higher patch (e.g. --version 1.0.1).`)
        }
        return 1
      }
      line('')
      line(`Published ${name}@${version}.`)
      line('The market index picks it up within about a minute.')
      if (config.indexUrl !== undefined) line(`Browse it at: ${config.indexUrl}`)
      return 0
    } finally {
      await rm(packDir, { recursive: true, force: true })
    }
  } catch (error) {
    line(`Publish failed: ${error.message}`)
    return 1
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
