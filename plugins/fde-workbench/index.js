/**
 * Host half of the delivery workbench.
 *
 * Owns the data root, the authenticated `/api/fde-workbench/*` routes, model
 * access, and session handoff. The browser half is a separate bundle.
 */
import { resolveConfig } from './src/host/config.js'
import { WorkbenchStore } from './src/host/store.js'
import { WorkbenchFiles } from './src/host/files.js'
import { createAiService } from './src/host/ai/service.js'
import { createHandoff } from './src/host/handoff.js'
import { createRouter, registerRoutes } from './src/host/routes.js'
import { ensureAgentsMd } from './src/host/agents-md.js'

export const name = 'fde-workbench'

/** The transport that carries the browser API. */
export const inject = ['connection']

/**
 * Wire the workbench into the host.
 * @param {object} ctx - owning Cordis context.
 * @param {object} [rawConfig] - row configuration from `cordis.patch.yml`.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const logger = ctx.logger ?? console
  for (const warning of config.warnings) logger.warn?.(`fde-workbench: ${warning}`)

  const store = new WorkbenchStore({ root: config.root, limits: config.limits, logger })
  const files = new WorkbenchFiles({ root: config.root, limits: config.limits, logger })
  const ai = createAiService({ ctx, config, store, files, logger })
  const handoff = createHandoff({ ctx, config, store, files, logger })
  const runtime = { ready: null, error: null, warnings: [] }

  runtime.ready = (async () => {
    await store.ensureReady()
    await ensureAgentsMd({ files, logger })
  })().catch(error => {
    runtime.error = error
    logger.warn?.(`fde-workbench: startup self-check failed: ${error instanceof Error ? error.message : String(error)}`)
  })

  const router = createRouter({ store, files, ai, handoff, config, logger, runtime })

  ctx.effect(() => {
    let disposers = []
    try {
      disposers = registerRoutes(ctx, router)
    } catch (error) {
      logger.warn?.(`fde-workbench: routes not registered: ${error instanceof Error ? error.message : String(error)}`)
    }
    return async () => {
      await Promise.all(disposers.map(dispose => dispose()))
    }
  }, 'fde-workbench: authenticated api routes')
}
