import {
  DEFAULT_API_KEY_ENV,
  MAX_TIMER_DELAY_MS,
  TINFOIL_WEBSEARCH_CONFIG_REPO,
  TINFOIL_WEBSEARCH_ORIGIN,
  nonEmptyString,
  positiveInteger,
  resolveApiKeyEnv,
  resolveHttpUrl,
} from '@srmico/dsh-tinfoil-lib'
import z from '@deepseek-ai/schemastery'

/** Stable provider id registered for both search and fetch. */
export const TINFOIL_PROVIDER_ID = 'tinfoil'

/** Attested websearch enclave origin. */
export const TINFOIL_WEB_ORIGIN = TINFOIL_WEBSEARCH_ORIGIN

/** Release repository verified by the attested client. */
export const TINFOIL_WEB_CONFIG_REPO = TINFOIL_WEBSEARCH_CONFIG_REPO

/** MCP endpoint path resolved from the attested origin. */
export { TINFOIL_MCP_PATH } from '@srmico/dsh-tinfoil-lib'

/** Tool names exposed by the attested websearch server. */
export const TINFOIL_SEARCH_TOOL = 'search'
export const TINFOIL_FETCH_TOOL = 'fetch'

/** Tool names exposed by Exa's hosted and local MCP servers. */
export const EXA_SEARCH_TOOL = 'web_search_exa'
export const EXA_FETCH_TOOL = 'web_fetch_exa'

/** Provider-side result cap; the server rejects more than this. */
export const MAX_SEARCH_RESULTS = 30

/** Maximum accepted fetch URL length in characters. */
export const MAX_FETCH_URL_LENGTH = 2048

/** Maximum URLs coalesced into one upstream fetch call. */
export const MAX_BATCH_URLS = 20

/** Default per-page character cap, matching the attested provider's truncation cap. */
export const MAX_PAGE_CHARS = 50_000

const MAX_BATCH_WINDOW_MS = 1_000

/** Plugin configuration. */
export interface Config {
  apiKeyEnv?: string
  endpoint?: string
  allowInsecureHttp?: boolean
  endpointApiKeyEnv?: string
  requestTimeoutMs?: number
  maxResponseBytes?: number
  maxPageChars?: number
  piiCheck?: boolean
  injectionCheck?: boolean
  batchFetch?: boolean
  batchWindowMs?: number
}

/** Validated configuration used by the client and providers. */
export interface ResolvedConfig {
  apiKeyEnv: string
  endpoint?: string
  allowInsecureHttp: boolean
  endpointApiKeyEnv?: string
  requestTimeoutMs: number
  maxResponseBytes: number
  maxPageChars: number
  piiCheck: boolean
  injectionCheck: boolean
  batchFetch: boolean
  batchWindowMs: number
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).description('Environment variable holding the Tinfoil API key for attested mode.'),
  endpoint: z.string().description('MCP endpoint for unattested Exa or local websearch use. When set, SecureClient attestation and the Tinfoil API key are bypassed.'),
  allowInsecureHttp: z.boolean().default(false).description('Allow plain HTTP to a non-loopback endpoint. Use only on a trusted private network.'),
  endpointApiKeyEnv: z.string().description('Optional environment variable holding an Exa API key, sent as x-api-key to endpoint. Omit for keyless or local endpoints.'),
  requestTimeoutMs: z.number().default(60000).description('Whole web operation deadline in milliseconds, including attestation, connect, and the batch window.'),
  maxResponseBytes: z.number().default(4194304).description('Maximum MCP HTTP response body in bytes.'),
  maxPageChars: z.number().default(MAX_PAGE_CHARS).description('Maximum characters returned for one fetched page.'),
  piiCheck: z.boolean().default(true).description('Send X-Tinfoil-Tool-PII-Check: true in attested mode.'),
  injectionCheck: z.boolean().default(true).description('Send X-Tinfoil-Tool-Injection-Check: true in attested mode.'),
  batchFetch: z.boolean().default(true).description('Coalesce concurrent web_fetch calls into one upstream multi-URL fetch.'),
  batchWindowMs: z.number().default(250).description('Coalescing window in milliseconds; a lone fetch waits up to this long before the upstream call.'),
})

function resolveBatchWindow(value: number): number {
  const window = positiveInteger(value, 'tinfoil-web: batchWindowMs')
  if (window > MAX_BATCH_WINDOW_MS) {
    throw new Error(`tinfoil-web: batchWindowMs must be no greater than ${MAX_BATCH_WINDOW_MS}`)
  }
  return window
}

/**
 * Validate and normalize plugin configuration.
 * @param config - raw plugin configuration.
 * @returns the resolved configuration.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const allowInsecureHttp = config.allowInsecureHttp ?? false
  const endpoint = resolveHttpUrl(config.endpoint, {
    label: 'tinfoil-web: endpoint',
    allowInsecureHttp,
  })
  const endpointApiKeyEnv = config.endpointApiKeyEnv === undefined
    ? undefined
    : nonEmptyString(config.endpointApiKeyEnv, 'tinfoil-web: endpointApiKeyEnv')
  if (endpoint === undefined && endpointApiKeyEnv !== undefined) {
    throw new Error('tinfoil-web: endpointApiKeyEnv requires endpoint')
  }
  const requestTimeoutMs = positiveInteger(config.requestTimeoutMs ?? 60000, 'tinfoil-web: requestTimeoutMs')
  if (requestTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tinfoil-web: requestTimeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    apiKeyEnv: resolveApiKeyEnv(config.apiKeyEnv, 'tinfoil-web: apiKeyEnv'),
    ...(endpoint === undefined ? {} : { endpoint }),
    allowInsecureHttp,
    ...(endpointApiKeyEnv === undefined ? {} : { endpointApiKeyEnv }),
    requestTimeoutMs,
    maxResponseBytes: positiveInteger(config.maxResponseBytes ?? 4194304, 'tinfoil-web: maxResponseBytes'),
    maxPageChars: positiveInteger(config.maxPageChars ?? MAX_PAGE_CHARS, 'tinfoil-web: maxPageChars'),
    piiCheck: config.piiCheck ?? true,
    injectionCheck: config.injectionCheck ?? true,
    batchFetch: config.batchFetch ?? true,
    batchWindowMs: resolveBatchWindow(config.batchWindowMs ?? 250),
  }
}

/** Whether the resolved configuration uses the unattested endpoint transport. */
export function isEndpointMode(config: ResolvedConfig): boolean {
  return config.endpoint !== undefined
}

/** Whether the Tinfoil API key is present in the launch environment. */
export function hasTinfoilApiKey(config: ResolvedConfig): boolean {
  const key = process.env[config.apiKeyEnv]?.trim()
  return key !== undefined && key.length > 0
}

/** Whether the optional endpoint API key is present, or no key is configured. */
export function hasEndpointApiKey(config: ResolvedConfig): boolean {
  if (config.endpointApiKeyEnv === undefined) return true
  const key = process.env[config.endpointApiKeyEnv]?.trim()
  return key !== undefined && key.length > 0
}
