/**
 * Tool definitions for the market publisher.
 *
 * This package is deliberately dependency-free: it registers raw tool
 * definitions (`{ name, description, parameters, output, execute }`) on the
 * host's `tools` service instead of importing `@deepseek-ai/dsh-tools`, so it
 * installs into any profile without dragging DSH internals behind it.
 *
 * Everything that touches the repository runs through the market checkout the
 * user points us at: `scripts/publish-plugin.mjs` (publish) and
 * `cli/bin/dsh-market.mjs` (preview). Nothing is re-implemented here.
 */

import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Category ids the market declares. */
const CATEGORIES = ['team', 'tools', 'data', 'productivity', 'other']

/** Absolute path of the DSH home directory. */
function homeDir(settings) {
  if (settings.dshHome !== '') return resolve(settings.dshHome)
  return process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? resolve(process.env.DSH_HOME)
    : join(homedir(), '.dsh')
}

/** Every plugin the Creator generated, newest first. */
async function createdPlugins(settings) {
  const profilesDir = join(homeDir(settings), 'profiles')
  let profiles
  try {
    profiles = await readdir(profilesDir, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const profile of profiles.filter((entry) => entry.isDirectory())) {
    const createdDir = join(profilesDir, profile.name, 'created-plugins')
    let created
    try {
      created = await readdir(createdDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of created.filter((candidate) => candidate.isDirectory())) {
      const dir = join(createdDir, entry.name)
      try {
        const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
        const info = await stat(join(dir, 'package.json'))
        found.push({ dir, profile: profile.name, name: String(manifest.name ?? ''), version: String(manifest.version ?? ''), mtimeMs: info.mtimeMs })
      } catch {
        continue
      }
    }
  }
  return found.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

/** Run a command, resolving with its combined output instead of throwing. */
function run(command, args, options) {
  return new Promise((done) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 180_000,
      signal: options.signal,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      done({
        ok: error === null,
        code: typeof error?.code === 'number' ? error.code : (error === null ? 0 : -1),
        output: `${stdout}${stderr}`.trim(),
        reason: error === null ? undefined : String(error.message ?? error),
      })
    })
  })
}

/** Require a configured market checkout before touching the repository. */
function repoOf(settings) {
  if (settings.repoPath === '') {
    throw new Error('未配置仓库路径：在 profile 的 cordis.patch.yml 里给 market-publisher 行加上 config.repoPath（指向 dsh-market 的本地 clone）')
  }
  return resolve(settings.repoPath)
}

/** Turn a Node error into a model-facing message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Keep the tail of a long command output readable in a tool result. */
function tail(text, limit = 3000) {
  if (text.length <= limit) return text
  return `…（前面省略 ${String(text.length - limit)} 字符）\n${text.slice(-limit)}`
}

/** Build the four tool definitions for one configuration. */
export function createPublisher(config = {}) {
  const settings = {
    repoPath: typeof config.repoPath === 'string' ? config.repoPath : '',
    registry: typeof config.registry === 'string' ? config.registry : '',
    author: typeof config.author === 'string' ? config.author : '',
    dshHome: typeof config.dshHome === 'string' ? config.dshHome : '',
  }

  const statusTool = {
    name: 'market_status',
    description:
      '查看公司插件市场的发布环境：市场仓库位置、npm 私库地址、本机已生成的插件列表。'
      + '用户问“我能发布吗/我有哪些插件/市场在哪”时先调用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['configured', 'summary', 'created'],
        properties: {
          configured: { type: 'boolean', description: '是否已配置市场仓库路径' },
          summary: { type: 'string', description: '给用户看的一段中文说明' },
          repo: { type: 'string' },
          registry: { type: 'string' },
          created: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'dir'],
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
                dir: { type: 'string' },
                profile: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value.summary ?? '') }],
    },
    execute: async () => {
      const created = await createdPlugins(settings)
      const configured = settings.repoPath !== ''
      const lines = []
      lines.push(configured ? `市场仓库：${resolve(settings.repoPath)}` : '市场仓库：未配置（需要在 profile 的 cordis.patch.yml 里设置 repoPath）')
      lines.push(settings.registry === '' ? 'npm 私库：未配置（发到 git 源）' : `npm 私库：${settings.registry}`)
      lines.push(created.length === 0 ? '本机还没有 Creator 生成的插件。' : `本机已生成 ${String(created.length)} 个插件：`)
      for (const plugin of created.slice(0, 10)) lines.push(`  · ${plugin.name}@${plugin.version} — ${plugin.dir}`)
      return {
        configured,
        summary: lines.join('\n'),
        ...(configured ? { repo: resolve(settings.repoPath) } : {}),
        ...(settings.registry === '' ? {} : { registry: settings.registry }),
        created: created.slice(0, 10).map((plugin) => ({ name: plugin.name, version: plugin.version, dir: plugin.dir, profile: plugin.profile })),
      }
    },
  }

  const previewTool = {
    name: 'market_preview',
    description:
      '预演一次发布：不改仓库、不推 npm，只显示会改成什么包名、包含哪些文件、体积多大、扫描有没有告警。'
      + '发布前必须调一次，把结果念给用户确认。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dir: { type: 'string', description: '要发布的插件目录；省略则用最新生成的那个' },
        name: { type: 'string', description: '包名 slug，例如 oncall-board（会补成 @acme-community/oncall-board）' },
        title: { type: 'string', description: '中文显示名' },
        description: { type: 'string', description: '一句话描述' },
        category: { type: 'string', enum: CATEGORIES, description: '分类' },
        version: { type: 'string', description: '版本号，默认 1.0.0' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'summary', 'output'],
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          output: { type: 'string', description: '预览命令的原始输出' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value.summary ?? '') }],
    },
    execute: async (args, exec) => {
      try {
        const repo = repoOf(settings)
        const cli = join(repo, 'cli', 'bin', 'dsh-market.mjs')
        const argv = [cli, 'publish']
        if (args.dir !== undefined && args.dir !== '') argv.push(resolve(args.dir))
        if (args.name !== undefined && args.name !== '') argv.push('--name', args.name)
        if (args.title !== undefined && args.title !== '') argv.push('--title', args.title)
        argv.push('--description', args.description !== undefined && args.description !== '' ? args.description : (args.title ?? '内部工作台插件'))
        if (args.category !== undefined && args.category !== '') argv.push('--category', args.category)
        if (args.version !== undefined && args.version !== '') argv.push('--version', args.version)
        if (settings.author !== '') argv.push('--author', settings.author)
        // The CLI refuses to preview without a registry; a dry run never contacts one,
        // so an unconfigured market previews against a placeholder.
        argv.push('--registry', settings.registry !== '' ? settings.registry : 'http://127.0.0.1:4873/')
        argv.push('--dry-run', '--yes')
        const result = await run(process.execPath, argv, { cwd: repo, signal: exec?.signal })
        return {
          ok: result.ok,
          summary: result.ok
            ? `预览完成，没有副作用：\n${tail(result.output, 2000)}`
            : `预览失败：${result.reason ?? ''}\n${tail(result.output, 2000)}`,
          output: tail(result.output, 4000),
        }      } catch (error) {
        return { ok: false, summary: `预览失败：${messageOf(error)}`, output: '' }
      }
    },
  }

  const publishTool = {
    name: 'market_publish',
    description:
      '把插件真正发到公司市场：规范化 → 提交到市场仓库 →（配置了私库时）npm publish → 重建索引 → 推送。'
      + '调用前必须先跑 market_preview 并让用户确认。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dir: { type: 'string', description: '要发布的插件目录；省略则用最新生成的那个' },
        name: { type: 'string', description: '包名 slug，例如 oncall-board' },
        title: { type: 'string', description: '中文显示名' },
        description: { type: 'string', description: '一句话描述' },
        category: { type: 'string', enum: CATEGORIES, description: '分类' },
        version: { type: 'string', description: '版本号，同一版本已存在时必须升版本' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'summary', 'output'],
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          output: { type: 'string', description: '发布命令的原始输出' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value.summary ?? '') }],
    },
    execute: async (args, exec) => {
      try {
        const repo = repoOf(settings)
        const script = join(repo, 'scripts', 'publish-plugin.mjs')
        const argv = [script]
        if (args.dir !== undefined && args.dir !== '') argv.push('--dir', resolve(args.dir))
        if (args.name !== undefined && args.name !== '') argv.push('--name', args.name)
        if (args.title !== undefined && args.title !== '') argv.push('--title', args.title)
        if (args.description !== undefined && args.description !== '') argv.push('--description', args.description)
        if (args.category !== undefined && args.category !== '') argv.push('--category', args.category)
        if (args.version !== undefined && args.version !== '') argv.push('--version', args.version)
        if (settings.author !== '') argv.push('--author', settings.author)
        if (settings.registry !== '') argv.push('--npm', '--registry', settings.registry)
        const result = await run(process.execPath, argv, { cwd: repo, signal: exec?.signal, timeoutMs: 600_000 })
        return {
          ok: result.ok,
          summary: result.ok
            ? `已发布。索引约 60 秒后刷新，同事在 Discover 刷新即可看到。\n${tail(result.output, 2000)}`
            : `发布失败：${result.reason ?? ''}\n${tail(result.output, 2000)}`,
          output: tail(result.output, 4000),
        }
      } catch (error) {
        return { ok: false, summary: `发布失败：${messageOf(error)}`, output: '' }
      }
    },
  }

  return {
    settings,
    definitions: () => [statusTool, previewTool, publishTool],
  }
}
