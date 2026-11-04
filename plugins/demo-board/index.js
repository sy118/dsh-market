/** Demo host half: a workbench page the Creator would have generated. */
export const name = 'demo-page'

/**
 * Register the page's server-side contribution.
 * @param {object} ctx - owning plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => () => {}, 'demo-page: nothing to release')
}
