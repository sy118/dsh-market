/**
 * HTTP surface of the market index service.
 *
 *   GET /index.json   the format-1 index DSH reads
 *   GET /icons/<file> icons too large to inline
 *   GET /healthz      build status for operators
 *   GET /             a one-line operator page
 *
 * The index is rebuilt on a timer and swapped atomically, so a poll never
 * serves a half-written document and a failed build keeps the previous one.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { buildMarket } from './build.mjs'
import { loadConfig } from './config.mjs'

const config = loadConfig()
const cache = new Map()
let blocklist = new Set()
let blocklistStamp = ''
let current
let building = false

/** Reload the blocklist when the file changes; a missing file means nothing is blocked. */
async function refreshBlocklist() {
  if (config.blocklistPath === '') return
  try {
    const info = await readFile(config.blocklistPath, 'utf8')
    const stamp = createHash('sha1').update(info).digest('hex')
    if (stamp === blocklistStamp) return
    const parsed = JSON.parse(info)
    const names = Array.isArray(parsed) ? parsed : parsed?.blocked
    if (!Array.isArray(names)) throw new Error('blocklist must be an array of package names')
    blocklist = new Set(names.filter((name) => typeof name === 'string'))
    blocklistStamp = stamp
    console.log(`[market-index] blocklist: ${blocklist.size} package(s) blocked`)
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error(`[market-index] blocklist ignored: ${error.message}`)
  }
}

/** Rebuild the served index; failures keep the previous one live. */
async function rebuild(reason) {
  if (building) return
  building = true
  try {
    await refreshBlocklist()
    const { index, icons, skipped } = await buildMarket(config, cache, blocklist)
    const body = Buffer.from(JSON.stringify(index))
    current = {
      body,
      icons,
      etag: `"${createHash('sha1').update(body).digest('hex')}"`,
      builtAt: new Date().toISOString(),
      plugins: index.plugins.length,
      skipped,
    }
    console.log(`[market-index] ${reason}: ${index.plugins.length} plugin(s), ${icons.size} external icon(s)`)
    for (const entry of skipped) console.warn(`[market-index] skipped ${entry}`)
  } catch (error) {
    console.error(`[market-index] build failed, keeping the previous index: ${error.stack ?? error.message}`)
  } finally {
    building = false
  }
}

/** Send a small JSON body. */
function json(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, ...headers })
  response.end(body)
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', config.publicBaseUrl)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    json(response, 405, { error: 'method not allowed' })
    return
  }
  if (url.pathname === '/healthz') {
    json(response, current === undefined ? 503 : 200, {
      ok: current !== undefined,
      plugins: current?.plugins ?? 0,
      builtAt: current?.builtAt ?? null,
      skipped: current?.skipped ?? [],
      storage: config.storageDir,
    })
    return
  }
  if (url.pathname === '/' || url.pathname === '') {
    const body = Buffer.from(`<!doctype html><meta charset="utf-8"><title>DSH market index</title>`
      + `<h1>DSH market index</h1><p>${current?.plugins ?? 0} plugin(s), built ${current?.builtAt ?? 'never'}.</p>`
      + `<p>Index: <a href="/index.json">/index.json</a></p>`)
    response.writeHead(current === undefined ? 503 : 200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length })
    response.end(body)
    return
  }
  if (url.pathname === '/index.json') {
    if (current === undefined) {
      json(response, 503, { error: 'index is not built yet' })
      return
    }
    if (request.headers['if-none-match'] === current.etag) {
      response.writeHead(304, { etag: current.etag })
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': current.body.length,
      'cache-control': 'no-cache',
      etag: current.etag,
    })
    response.end(request.method === 'HEAD' ? undefined : current.body)
    return
  }
  const icon = url.pathname.startsWith('/icons/') ? current?.icons.get(decodeURIComponent(url.pathname.slice('/icons/'.length))) : undefined
  if (icon !== undefined) {
    response.writeHead(200, {
      'content-type': icon.type,
      'content-length': icon.contents.length,
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : icon.contents)
    return
  }
  json(response, 404, { error: 'not found' })
})

await rebuild('startup')
setInterval(() => { void rebuild('poll') }, config.pollMs).unref()

server.listen(config.port, config.host, () => {
  console.log(`[market-index] listening on http://${config.host}:${config.port} (scope ${config.scope})`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[market-index] ${signal}: shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
