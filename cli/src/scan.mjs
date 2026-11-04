/**
 * Publish gates that run without a human reviewer: credentials, personal data,
 * internal hostnames, native artifacts, and size limits. Blocks stop the
 * publish; warnings need an explicit `--yes`.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Content rules; the first matching rule per line is reported. */
const RULES = [
  { id: 'private-key', severity: 'block', pattern: /-----BEGIN (?:RSA |OPENSSH |EC |PGP )?PRIVATE KEY-----/, message: 'private key material' },
  { id: 'openai-key', severity: 'block', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, message: 'an API key that looks like sk-…' },
  { id: 'github-token', severity: 'block', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/, message: 'a GitHub token' },
  { id: 'aws-key', severity: 'block', pattern: /\bAKIA[0-9A-Z]{16}\b/, message: 'an AWS access key id' },
  { id: 'slack-token', severity: 'block', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, message: 'a Slack token' },
  { id: 'bearer-token', severity: 'block', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/, message: 'a bearer token' },
  { id: 'assigned-secret', severity: 'warn', pattern: /\b(?:password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i, message: 'a literal secret-looking assignment' },
  { id: 'email', severity: 'warn', pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/, message: 'an email address' },
  { id: 'phone-cn', severity: 'warn', pattern: /(?<![\d.])1[3-9]\d{9}(?![\d.])/, message: 'a Chinese mobile number' },
  { id: 'windows-home-path', severity: 'warn', pattern: /[A-Za-z]:\\\\?Users\\\\?[^\\/\s]+/i, message: 'a local Windows user path' },
  { id: 'loopback-host', severity: 'warn', pattern: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/, message: 'a loopback address, which only works on your machine' },
]

const MAX_SCAN_BYTES = 1024 * 1024

/** Whether a buffer looks like text. */
function isText(buffer) {
  return !buffer.subarray(0, 4096).includes(0)
}

/** Recursively collect files with their sizes. */
async function walk(directory, root = directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      await walk(path, root, files)
    } else if (entry.isFile()) {
      files.push({ path, relative: path.slice(root.length + 1), size: (await stat(path)).size })
    }
  }
  return files
}

/**
 * Scan a normalized package directory.
 * @param {string} directory - package root to scan.
 * @returns {Promise<{ findings: Array<object>, files: number, bytes: number, largest: Array<object> }>} gate results.
 */
export async function scanPackage(directory) {
  const files = await walk(directory)
  const findings = []
  let bytes = 0

  for (const file of files) {
    bytes += file.size
    if (/\.(node|so|dll|dylib)$/i.test(file.relative)) {
      findings.push({ severity: 'block', rule: 'native-binary', file: file.relative, line: 0, message: 'a compiled native binary' })
      continue
    }
    if (file.size > MAX_SCAN_BYTES) continue
    const buffer = await readFile(file.path)
    if (!isText(buffer)) continue
    if (/\.npmrc$/.test(file.relative)) {
      findings.push({ severity: 'block', rule: 'npmrc', file: file.relative, line: 0, message: 'an npm configuration file' })
      continue
    }
    if (/(^|\/)\.env(\.|$)/.test(file.relative)) {
      findings.push({ severity: 'block', rule: 'env-file', file: file.relative, line: 0, message: 'an environment file' })
      continue
    }
    if (/\.(pem|key|p12|pfx)$/i.test(file.relative)) {
      findings.push({ severity: 'block', rule: 'key-file', file: file.relative, line: 0, message: 'a key or certificate file' })
      continue
    }
    const lines = buffer.toString('utf8').split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (line.length > 2000) continue
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue
        findings.push({ severity: rule.severity, rule: rule.id, file: file.relative, line: index + 1, message: rule.message, excerpt: line.trim().slice(0, 120) })
        break
      }
    }
  }

  // A dependency is not resolved here; a package that ships build scripts is
  // rejected earlier by normalization, so this only catches leftovers.
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
      if (typeof manifest.scripts?.[name] === 'string') {
        findings.push({ severity: 'block', rule: 'install-script', file: 'package.json', line: 0, message: `a ${name} script` })
      }
    }
    if (manifest.gypfile === true) {
      findings.push({ severity: 'block', rule: 'native-build', file: 'package.json', line: 0, message: 'a gyp build' })
    }
  } catch {
    findings.push({ severity: 'block', rule: 'manifest', file: 'package.json', line: 0, message: 'an unreadable package.json' })
  }

  const largest = files
    .map((file) => ({ file: file.relative, size: file.size }))
    .sort((left, right) => right.size - left.size)
    .slice(0, 5)

  return { findings, files: files.length, bytes, largest }
}

/** Fold repeated findings so one rule on one line is reported once. */
export function dedupe(findings) {
  const seen = new Set()
  return findings.filter((finding) => {
    const key = `${finding.rule}|${finding.file}|${finding.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
