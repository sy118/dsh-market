/** Host entry wiring: route registration, startup self-check, and disposal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apply, inject, name } from '../index.js'
import { tempRoot } from './helpers.mjs'

/** A minimal Cordis-like context. */
function fakeContext() {
  const registered = []
  const removed = []
  const effects = []
  const warnings = []
  const ctx = {
    connection: {
      fetch: {
        register(route) {
          registered.push(route)
          return async () => { removed.push(route.path) }
        },
      },
    },
    get() { return undefined },
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return () => {}
    },
    logger: { info() {}, warn(message) { warnings.push(message) } },
  }
  return { ctx, registered, removed, effects, warnings }
}

test('index: registers eleven routes and disposes them', async t => {
  const root = await tempRoot(t)
  const { ctx, registered, removed, effects } = fakeContext()
  assert.equal(name, 'fde-workbench')
  assert.deepEqual(inject, ['connection'])
  apply(ctx, { root })
  assert.equal(registered.length, 11)
  for (const route of registered) assert.ok(route.path.startsWith('/api/fde-workbench/'))
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok((await readFile(join(root, 'AGENTS.md'), 'utf8')).includes('fde-workbench: schema 2'))
  await Promise.all(effects.map(dispose => dispose()))
  assert.equal(removed.length, 11)
})

test('index: a failed self-check keeps the plugin loaded and reports rootError', async t => {
  const root = await tempRoot(t)
  const blocked = join(root, 'blocked')
  await writeFile(blocked, 'not a directory', 'utf8')
  const { ctx, registered, warnings } = fakeContext()
  apply(ctx, { root: blocked })
  assert.equal(registered.length, 11)
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(warnings.some(message => message.includes('startup self-check failed')))
  const stateRoute = registered.find(route => route.path.endsWith('/state'))
  const response = await stateRoute.fetch(new Request('http://localhost/api/fde-workbench/state'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.readOnly, true)
  assert.equal(body.rootError.code, 'root/unavailable')
  assert.equal(body.state.projects.length, 0)

  const mutateRoute = registered.find(route => route.path.endsWith('/mutate'))
  const denied = await mutateRoute.fetch(new Request('http://localhost/api/fde-workbench/mutate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mutation: { op: 'project.create', name: 'x' } }),
  }))
  assert.equal(denied.status, 503)
  assert.equal((await denied.json()).error.code, 'root/unavailable')
})

test('index: missing connection.fetch logs a warning instead of throwing', async t => {
  const root = await tempRoot(t)
  const warnings = []
  const effects = []
  const ctx = {
    connection: {},
    get() { return undefined },
    effect(callback) { effects.push(callback()); return () => {} },
    logger: { info() {}, warn(message) { warnings.push(message) } },
  }
  assert.doesNotThrow(() => apply(ctx, { root }))
  assert.ok(warnings.some(message => message.includes('routes not registered')))
  await Promise.all(effects.map(dispose => dispose()))
})
