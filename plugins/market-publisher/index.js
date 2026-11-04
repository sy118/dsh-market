/**
 * Market publisher — the first plugin in the market.
 *
 * Registers `market_status`, `market_preview` and `market_publish` so an agent
 * can walk a colleague from "I made a workbench" to "it is in the market"
 * without them learning a command line.
 */

import { createPublisher } from './lib/tools.mjs'

export const name = 'market-publisher'

/** The host service this plugin contributes to. */
export const inject = ['tools']

/**
 * Register the three publishing tools.
 * @param {object} ctx - owning plugin context.
 * @param {object} [config] - row configuration from `cordis.patch.yml`.
 */
export function apply(ctx, config = {}) {
  const publisher = createPublisher(config ?? {})
  for (const definition of publisher.definitions()) ctx.tools.register(definition)
}
