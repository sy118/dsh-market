/**
 * Model-route discovery.
 *
 * The workbench never owns a key or a provider: it asks the composed DSH
 * services which route to use, then verifies that route before enabling any
 * AI control. Failure is reported as a reason code the panel can translate.
 */

/** Stable reasons returned to the browser. */
export const AI_REASONS = {
  noLlm: 'ai/no-llm',
  noRoute: 'ai/no-route',
  providerMissing: 'ai/provider-missing',
  modelMissing: 'ai/model-missing',
  unavailable: 'ai/unavailable',
  noCatalog: 'ai/catalog-empty',
  missingCredential: 'ai/missing-credential',
}

/** Resolve the route from plugin config, then the deployment default. */
function resolveRoute(ctx, config) {
  if (config.ai.provider !== '' && config.ai.model !== '') {
    return { provider: config.ai.provider, model: config.ai.model, source: 'config' }
  }
  const defaults = ctx?.get?.('agentDefaultModel')
  try {
    const selection = defaults?.currentSelection?.()
    if (selection !== undefined && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      return { provider: selection.provider, model: selection.model, source: 'default' }
    }
  } catch {
    /* the default service is optional and may be absent */
  }
  return undefined
}

/**
 * Describe whether AI can run and which route it would use.
 * @param {object} options - plugin context and resolved config.
 * @returns {Promise<object>} status with `available`, `provider`, `model`, `reason`.
 */
export async function describeAi(options) {
  const { ctx, config } = options
  const llm = ctx?.get?.('llm')
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
    return { available: false, provider: '', model: '', reason: AI_REASONS.noLlm }
  }
  const route = resolveRoute(ctx, config)
  if (route === undefined) {
    return { available: false, provider: '', model: '', reason: AI_REASONS.noRoute }
  }
  const base = { available: false, provider: route.provider, model: route.model, source: route.source }
  let providers
  try {
    providers = llm.listProviders?.() ?? []
  } catch {
    providers = []
  }
  if (Array.isArray(providers) && providers.length > 0 && !providers.some(provider => provider.id === route.provider)) {
    return { ...base, reason: AI_REASONS.providerMissing }
  }
  if (typeof llm.resolveModelInfo === 'function') {
    try {
      // The exact-route resolution is the strongest availability signal: it
      // fails when the adapter or its credential is missing.
      const info = await llm.resolveModelInfo(route.provider, route.model)
      return {
        available: true,
        provider: route.provider,
        model: route.model,
        modelName: typeof info?.name === 'string' ? info.name : route.model,
        source: route.source,
        reason: null,
      }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : ''
      if (code.includes('MODEL')) return { ...base, reason: AI_REASONS.modelMissing }
      return { ...base, reason: AI_REASONS.unavailable }
    }
  }
  let models
  try {
    models = llm.listModels?.(route.provider)
  } catch {
    return { ...base, reason: AI_REASONS.unavailable }
  }
  if (Array.isArray(models) && models.length > 0 && !models.some(model => model.id === route.model)) {
    return { ...base, reason: AI_REASONS.modelMissing }
  }
  return {
    available: true,
    provider: route.provider,
    model: route.model,
    modelName: route.model,
    source: route.source,
    reason: Array.isArray(models) && models.length === 0 ? AI_REASONS.noCatalog : null,
  }
}
