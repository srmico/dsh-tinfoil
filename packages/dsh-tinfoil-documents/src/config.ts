import { resolve } from 'node:path'
import {
  DEFAULT_API_KEY_ENV,
  TINFOIL_ROUTER_CONFIG_REPO,
  nonEmptyString,
  positiveInteger,
  resolveApiKeyEnv,
  resolveHttpUrl,
} from '@srmico/dsh-tinfoil-lib'
import { dshCachePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'

export interface Config {
  apiKeyEnv?: string
  endpoint?: string
  allowInsecureHttp?: boolean
  cacheDir?: string
  maxCacheBytes?: number
  cacheTtlMs?: number
  maxInputBytes?: number
  maxResponseBytes?: number
  requestTimeoutMs?: number
  maxOutputChars?: number
  defaultPageWindow?: number
  maxPages?: number
  includeProviderErrorDetail?: boolean
}

export interface ResolvedConfig {
  apiKeyEnv: string
  endpoint?: string
  allowInsecureHttp: boolean
  cacheDir: string
  cacheIdentity: string
  maxCacheBytes: number
  cacheTtlMs: number
  maxInputBytes: number
  maxResponseBytes: number
  requestTimeoutMs: number
  maxOutputChars: number
  defaultPageWindow: number
  maxPages: number
  includeProviderErrorDetail: boolean
}

export const defaultCacheDir = (): string => dshCachePath('dsh-tinfoil-documents', 'conversions')

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).description('Environment variable holding the Tinfoil API key.'),
  endpoint: z.string().description('Base URL of a self-hosted document conversion service. When set, SecureClient and TINFOIL_API_KEY are bypassed.'),
  allowInsecureHttp: z.boolean().default(false).description('Allow plain HTTP to a non-loopback endpoint. Use only on a trusted private network.'),
  cacheDir: z.string().description('Conversion cache directory. Defaults to $DSH_HOME/cache/dsh-tinfoil-documents/conversions.'),
  maxCacheBytes: z.number().default(1073741824).description('Conversion cache disk budget in bytes.'),
  cacheTtlMs: z.number().default(7776000000).description('Evict conversions unused for this many milliseconds.'),
  maxInputBytes: z.number().default(52428800).description('Maximum source document size in bytes.'),
  maxResponseBytes: z.number().default(268435456).description('Maximum conversion response body in bytes.'),
  requestTimeoutMs: z.number().default(300000).description('Conversion deadline in milliseconds, including attestation.'),
  maxOutputChars: z.number().default(100000).description('Maximum characters returned by one read_document call.'),
  defaultPageWindow: z.number().default(10).description('Pages returned when page_end is omitted.'),
  maxPages: z.number().default(2000).description('Maximum page count accepted from one conversion.'),
  includeProviderErrorDetail: z.boolean().default(false).description('Include bounded provider error detail in model-visible errors. Treat it as untrusted.'),
})

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const allowInsecureHttp = config.allowInsecureHttp ?? false
  const endpoint = resolveHttpUrl(config.endpoint, {
    label: 'tinfoil-documents: endpoint',
    allowInsecureHttp,
  })
  const cacheDir = nonEmptyString(config.cacheDir ?? defaultCacheDir(), 'tinfoil-documents: cacheDir')
  return {
    apiKeyEnv: resolveApiKeyEnv(config.apiKeyEnv, 'tinfoil-documents: apiKeyEnv'),
    ...(endpoint === undefined ? {} : { endpoint }),
    allowInsecureHttp,
    cacheDir: resolve(expandHomePath(cacheDir)),
    cacheIdentity: endpoint === undefined
      ? `sdk:${TINFOIL_ROUTER_CONFIG_REPO}`
      : `endpoint:${endpoint}`,
    maxCacheBytes: positiveInteger(config.maxCacheBytes ?? 1073741824, 'tinfoil-documents: maxCacheBytes'),
    cacheTtlMs: positiveInteger(config.cacheTtlMs ?? 7776000000, 'tinfoil-documents: cacheTtlMs'),
    maxInputBytes: positiveInteger(config.maxInputBytes ?? 52428800, 'tinfoil-documents: maxInputBytes'),
    maxResponseBytes: positiveInteger(config.maxResponseBytes ?? 268435456, 'tinfoil-documents: maxResponseBytes'),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs ?? 300000, 'tinfoil-documents: requestTimeoutMs'),
    maxOutputChars: positiveInteger(config.maxOutputChars ?? 100000, 'tinfoil-documents: maxOutputChars'),
    defaultPageWindow: positiveInteger(config.defaultPageWindow ?? 10, 'tinfoil-documents: defaultPageWindow'),
    maxPages: positiveInteger(config.maxPages ?? 2000, 'tinfoil-documents: maxPages'),
    includeProviderErrorDetail: config.includeProviderErrorDetail ?? false,
  }
}
