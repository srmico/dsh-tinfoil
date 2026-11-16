import z from '@deepseek-ai/schemastery'
import { RetryPolicySchema, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_API_KEY_ENV,
  nonEmptyString,
  positiveInteger,
  resolveApiKeyEnv,
  resolveHttpUrl,
} from '@srmico/dsh-tinfoil-lib'
import { materializeModels } from './catalog.js'
import type {
  Compat,
  ModelProfile,
  Protocol,
  ReasoningEfforts,
  ResolvedModel,
} from './catalog.js'

/** Connection and attestation mode. */
export type Mode = 'sdk' | 'proxy' | 'direct'

/** Native Tinfoil web-search settings inserted into chat requests. */
export interface WebSearchConfig {
  enabled?: boolean
  piiCheck?: boolean
  injectionCheck?: boolean
}

/** Resolved native web-search settings. */
export interface ResolvedWebSearchConfig {
  enabled: boolean
  piiCheck: boolean
  injectionCheck: boolean
}

/** Plugin configuration. */
export interface Config {
  provider?: string
  displayName?: string
  apiKeyEnv?: string
  mode?: Mode
  baseURL?: string
  allowInsecureHttp?: boolean
  api?: Protocol
  models?: ModelProfile[]
  compat?: Compat
  headers?: Record<string, string>
  timeoutMs?: number
  streamIdleTimeoutMs?: number
  retryPolicy?: RetryPolicyConfig
  webSearch?: WebSearchConfig
}

/** Validated configuration the adapter is built from. */
export interface ResolvedConfig {
  provider: string
  displayName: string
  apiKeyEnv: string
  mode: Mode
  baseURL: string
  allowInsecureHttp: boolean
  models: readonly ResolvedModel[]
  headers?: Record<string, string>
  timeoutMs: number
  streamIdleTimeoutMs: number
  retryPolicy: ResolvedRetryPolicy
  configuredMaxTokens: ReadonlyMap<string, number>
  webSearch: ResolvedWebSearchConfig
}

const MODES: readonly Mode[] = ['sdk', 'proxy', 'direct']
const PROTOCOLS: readonly Protocol[] = ['openai-responses', 'openai-completions']

const DEFAULT_BASE_URL: Readonly<Record<Mode, string>> = {
  sdk: 'https://inference.tinfoil.sh/v1',
  proxy: 'http://127.0.0.1:3301/v1',
  direct: 'https://inference.tinfoil.sh/v1',
}

const compatSchema = z.object({
  supportsDeveloperRole: z.boolean(),
  supportsStore: z.boolean(),
  supportsReasoningEffort: z.boolean(),
  maxTokensField: z.union(['max_tokens', 'max_completion_tokens'] as const),
  supportsUsageInStreaming: z.boolean(),
  supportsMaxOutputTokens: z.boolean(),
})

const reasoningEffortsSchema = z.dict(
  z.union([z.string(), z.const(null)]),
) as unknown as z<ReasoningEfforts>

const modelProfileSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  api: z.union(PROTOCOLS),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  input: z.array(z.union(['text', 'image'] as const)),
  reasoningEfforts: z.union([z.const(false), reasoningEffortsSchema]),
  compat: compatSchema,
}) as unknown as z<ModelProfile>

const webSearchSchema = z.object({
  enabled: z.boolean().default(true).description('Inject Tinfoil native web search (search and page opening) into every Responses/Chat request.'),
  piiCheck: z.boolean().default(true).description('Send pii_check_options with native web search.'),
  injectionCheck: z.boolean().default(true).description('Send prompt_injection_check_options with native web search.'),
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  provider: z.string().default('tinfoil').description('Provider route id.'),
  displayName: z.string().default('Tinfoil').description('Provider label shown by selectors.'),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).description('Environment variable holding the Tinfoil API key.'),
  mode: z.union(MODES).default('sdk').description('Connection and attestation mode. sdk uses the official Tinfoil SDK; proxy uses the local attested proxy; direct is unattested.'),
  baseURL: z.string().description('Endpoint for proxy or direct mode. In sdk mode the origin is ignored and the path is forwarded to the attested router; keep the standard /v1 path.'),
  allowInsecureHttp: z.boolean().default(false).description('Allow plain HTTP to a non-loopback baseURL. Use only on a trusted private network.'),
  api: z.union(PROTOCOLS).default('openai-responses').description('Default wire protocol for new models. Shipped models keep their own protocol unless an entry sets api.'),
  models: z.array(modelProfileSchema).description('Model entries merged by id onto the shipped Tinfoil chat catalog.'),
  compat: compatSchema.description('Route-level wire-compatibility defaults; per-model entries override.'),
  headers: z.dict(z.string()).description('Additional request headers. Harness attribution wins reserved names.'),
  timeoutMs: z.natural().default(600000).description('Provider request timeout in milliseconds, including a first-request attestation.'),
  streamIdleTimeoutMs: z.natural().default(300000).description('Maximum provider idle time while one stream read is outstanding.'),
  retryPolicy: RetryPolicySchema.description('Provider-owned retry policy executed by dsh-llm-retry.'),
  webSearch: webSearchSchema.description('Inject Tinfoil native web search (search and page opening) into Responses/Chat requests. One provider fee applies per model request when search is used. Enabled by default; set enabled: false to use DSH web tools instead.'),
}) as z<Config>

/**
 * Resolve and validate the plugin configuration.
 * @param config - raw plugin configuration.
 * @returns the validated configuration and materialized catalog.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const provider = nonEmptyString(config.provider ?? 'tinfoil', 'tinfoil-provider: provider')
  const displayName = nonEmptyString(config.displayName ?? 'Tinfoil', 'tinfoil-provider: displayName')
  const apiKeyEnv = resolveApiKeyEnv(config.apiKeyEnv, 'tinfoil-provider: apiKeyEnv')
  const mode = modeOf(config.mode)
  const allowInsecureHttp = config.allowInsecureHttp ?? false
  const api = protocolOf(config.api)
  const baseURL = resolveBaseURL(config.baseURL, mode, allowInsecureHttp)
  const headers = resolveHeaders(config.headers)
  const timeoutMs = positiveInteger(config.timeoutMs ?? 600000, 'tinfoil-provider: timeoutMs')
  const streamIdleTimeoutMs = positiveInteger(config.streamIdleTimeoutMs ?? 300000, 'tinfoil-provider: streamIdleTimeoutMs')
  const models = materializeModels(config.models, api, config.compat)
  return {
    provider,
    displayName,
    apiKeyEnv,
    mode,
    baseURL,
    allowInsecureHttp,
    models,
    ...headers === undefined ? {} : { headers },
    timeoutMs,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'tinfoil-provider: retryPolicy'),
    configuredMaxTokens: new Map(models.map(model => [model.id, model.maxTokens])),
    webSearch: resolveWebSearch(config.webSearch),
  }
}

function resolveWebSearch(config: WebSearchConfig | undefined): ResolvedWebSearchConfig {
  return {
    enabled: config?.enabled ?? true,
    piiCheck: config?.piiCheck ?? true,
    injectionCheck: config?.injectionCheck ?? true,
  }
}

function modeOf(value: Mode | undefined): Mode {
  if (value === undefined) return 'sdk'
  if (!MODES.includes(value)) throw new Error(`tinfoil-provider: mode must be one of ${MODES.join(', ')}`)
  return value
}

function protocolOf(value: Protocol | undefined): Protocol {
  if (value === undefined) return 'openai-responses'
  if (!PROTOCOLS.includes(value)) {
    throw new Error(`tinfoil-provider: api must be one of ${PROTOCOLS.join(', ')}`)
  }
  return value
}

function resolveBaseURL(value: string | undefined, mode: Mode, allowInsecureHttp: boolean): string {
  const raw = value ?? DEFAULT_BASE_URL[mode]
  const resolved = resolveHttpUrl(raw, {
    label: 'tinfoil-provider: baseURL',
    allowInsecureHttp,
  })
  if (resolved === undefined) {
    throw new Error('tinfoil-provider: baseURL must be an absolute http(s) URL')
  }
  const url = new URL(resolved)
  if (mode === 'sdk' && url.pathname.replace(/\/+$/u, '') !== '/v1') {
    throw new Error('tinfoil-provider: baseURL in sdk mode must use the /v1 path; the attested router expects the full inference path')
  }
  return resolved
}

const RESERVED_HEADERS = new Set(['authorization', 'x-api-key', 'host', 'content-length', 'connection'])

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  const entries = Object.entries(headers)
  if (entries.length === 0) return undefined
  for (const [name, value] of entries) {
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new Error(`tinfoil-provider: header "${name}" is reserved; use apiKeyEnv for credentials`)
    }
    try {
      new Headers([[name, value]])
    } catch {
      throw new Error(`tinfoil-provider: header "${name}" is not valid for Fetch`)
    }
  }
  return Object.fromEntries(entries)
}
