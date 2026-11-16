import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type {
  Api,
  Model,
  Provider,
  ProviderStreams,
  StreamOptions,
} from '@earendil-works/pi-ai'
import type { Protocol } from './catalog.js'
import type { ResolvedConfig } from './config.js'
import { withWebSearch } from './native-web-search.js'
import type { SecureFetch } from './secure-fetch.js'

const PROVIDER_APIS: Readonly<Record<Protocol, ProviderStreams>> = {
  'openai-responses': openAIResponsesApi(),
  'openai-completions': openAICompletionsApi(),
}

/**
 * Materialize the resolved catalog into pi-ai model descriptors.
 * @param config - resolved provider configuration.
 * @returns one model per catalog entry, in catalog order.
 */
export function buildPiModels(config: ResolvedConfig): readonly Model<Api>[] {
  return config.models.map(model => ({
    id: model.id,
    name: model.name,
    api: model.api,
    provider: config.provider,
    baseUrl: config.baseURL,
    input: [...model.input],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: model.thinkingLevelMap },
    compat: model.compat,
  }))
}

/**
 * Build the pi-ai provider behind the Tinfoil route.
 * @param config - resolved provider configuration.
 * @param models - materialized chat models.
 * @param secureFetch - attested transport for sdk mode; omitted for proxy/direct.
 * @returns a static pi-ai provider.
 */
export function buildTinfoilProvider(
  config: ResolvedConfig,
  models: readonly Model<Api>[],
  secureFetch: SecureFetch | undefined,
): Provider {
  const fetchImpl = secureFetch?.fetch
  return {
    id: config.provider,
    name: config.displayName,
    baseUrl: config.baseURL,
    auth: {
      apiKey: {
        name: config.displayName,
        resolve: async ({ credential }) => ({
          auth: credential?.key === undefined ? {} : { apiKey: credential.key },
          source: config.displayName,
        }),
      },
    },
    getModels: () => models,
    stream: (model, context, options) =>
      apiFor(model).stream(model, context, withWebSearch(withFetch(options, fetchImpl), config.webSearch)),
    streamSimple: (model, context, options) =>
      apiFor(model).streamSimple(model, context, withWebSearch(withFetch(options, fetchImpl), config.webSearch)),
  }
}

function apiFor(model: Model<Api>): ProviderStreams {
  const api = PROVIDER_APIS[model.api as Protocol]
  if (api === undefined) {
    throw new Error(`tinfoil-provider: unsupported wire protocol "${model.api}"`)
  }
  return api
}

function withFetch<T extends StreamOptions>(
  options: T | undefined,
  fetchImpl: typeof globalThis.fetch | undefined,
): T {
  if (fetchImpl === undefined) return (options ?? {}) as T
  return { ...options, fetch: fetchImpl } as T
}
