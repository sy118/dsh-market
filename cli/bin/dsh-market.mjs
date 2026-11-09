#!/usr/bin/env node
/** `dsh-market` — publish a plugin made in your own DSH to the company market. */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { login } from '../src/login.mjs'
import { configure, created, list } from '../src/list.mjs'
import { publish } from '../src/publish.mjs'
import { line } from '../src/ui.mjs'

// `--version` is only the version command when it stands alone; `publish --version 1.2.3`
// carries the release version and must reach the publish command instead.
const BOOLEAN_FLAGS = new Set(['dry-run', 'yes', 'help'])

const HELP = `dsh-market — publish a workbench plugin made in your own DSH

Usage
  dsh-market login    [--registry URL] [--username U] [--password P] [--token T]
  dsh-market publish  [dir] [--name SLUG] [--title T] [--description D]
                      [--category team|tools|data|productivity|other]
                      [--version V] [--registry URL] [--dsh-range R]
                      [--dry-run] [--yes]
  dsh-market list     [--index URL]
  dsh-market created
  dsh-market config   [--registry URL] [--index URL] [--scope @scope] [--dsh-range R]

Notes
  publish without a directory picks the newest plugin under
  $DSH_HOME/profiles/*/created-plugins.
  --dry-run normalizes, scans, and packs, then stops before uploading.
  The index URL is what people add in DSH: Plugins → Discover → Index sources.
`

/** Split argv into one command and its flags. */
function parse(argv) {
  const flags = {}
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    const equals = argument.indexOf('=')
    if (equals !== -1) {
      flags[argument.slice(2, equals)] = argument.slice(equals + 1)
      continue
    }
    const name = argument.slice(2)
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      flags[name] = true
    } else {
      flags[name] = value
      index += 1
    }
  }
  return { command: positional[0], positional: positional.slice(1), flags }
}

/** Print the CLI version. */
async function version() {
  const manifest = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
  line(manifest.version)
}

const { command, positional, flags } = parse(process.argv.slice(2))

if (flags.version === true) {
  await version()
  process.exit(0)
}
if (flags.help === true || command === 'help' || command === undefined) {
  line(HELP)
  process.exit(flags.help === true || command === 'help' ? 0 : 1)
}

const options = {
  registry: typeof flags.registry === 'string' ? flags.registry : undefined,
  index: typeof flags.index === 'string' ? flags.index : undefined,
  username: typeof flags.username === 'string' ? flags.username : undefined,
  password: typeof flags.password === 'string' ? flags.password : undefined,
  token: typeof flags.token === 'string' ? flags.token : undefined,
  name: typeof flags.name === 'string' ? flags.name : undefined,
  title: typeof flags.title === 'string' ? flags.title : undefined,
  description: typeof flags.description === 'string' ? flags.description : undefined,
  category: typeof flags.category === 'string' ? flags.category : undefined,
  version: typeof flags.version === 'string' ? flags.version : undefined,
  dshRange: typeof flags['dsh-range'] === 'string' ? flags['dsh-range'] : undefined,
  scope: typeof flags.scope === 'string' ? flags.scope : undefined,
  dryRun: flags['dry-run'] === true,
  yes: flags.yes === true,
}

let code
switch (command) {
  case 'login':
    code = await login(options)
    break
  case 'publish':
    code = await publish({ ...options, dir: positional[0] })
    break
  case 'list':
    code = await list(options)
    break
  case 'created':
    code = await created()
    break
  case 'config':
    code = await configure(options)
    break
  default:
    line(`Unknown command ${JSON.stringify(command)}. Run dsh-market --help.`)
    code = 1
}
process.exitCode = code ?? 0
