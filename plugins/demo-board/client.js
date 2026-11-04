/** Demo browser half: the page's UI, mounted into the plugin's own slot. */

/**
 * Register the browser contribution.
 * @param {object} ctx - owning plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => () => {}, 'demo-page: remove the rendered page')
}
