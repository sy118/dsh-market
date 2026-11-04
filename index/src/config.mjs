/** Environment-driven configuration for the market index service. */

/** Read a positive integer from the environment, or the fallback. */
function integer(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** A comma-separated list, trimmed and without empty entries. */
function list(value) {
  return (value ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '')
}

/**
 * Read the service configuration.
 * @param {Record<string, string | undefined>} env - process environment.
 * @returns {object} resolved configuration.
 */
export function loadConfig(env = process.env) {
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
  return {
    storageDir: env.REGISTRY_STORAGE ?? '/verdaccio/storage',
    scope: env.SCOPE ?? '@acme-community',
    registryUrl: (env.REGISTRY_URL ?? 'http://127.0.0.1:4873/').replace(/\/+$/, '') + '/',
    publicBaseUrl,
    title: { zh: env.TITLE_ZH ?? '公司插件市场', en: env.TITLE_EN ?? 'Acme DSH plugins' },
    description: {
      zh: env.DESC_ZH ?? '同事做的工作台插件，装了就能用',
      en: env.DESC_EN ?? 'Workbench plugins built by colleagues',
    },
    blocklistPath: env.BLOCKLIST ?? '',
    officialAuthors: list(env.OFFICIAL_AUTHORS),
    pollMs: integer(env.POLL_MS, 60_000),
    maxVersions: integer(env.MAX_VERSIONS, 50),
    port: integer(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
  }
}
