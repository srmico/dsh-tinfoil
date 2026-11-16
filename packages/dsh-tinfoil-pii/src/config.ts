import {
  DEFAULT_API_KEY_ENV,
  positiveInteger,
  resolveApiKeyEnv,
} from '@srmico/dsh-tinfoil-lib'
import z from '@deepseek-ai/schemastery'

export interface Config {
  apiKeyEnv?: string
  maxTextInputBytes?: number
  maxFileInputBytes?: number
  maxResponseBytes?: number
  requestTimeoutMs?: number
}

export interface ResolvedConfig {
  apiKeyEnv: string
  maxTextInputBytes: number
  maxFileInputBytes: number
  maxResponseBytes: number
  requestTimeoutMs: number
}

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).description('Environment variable holding the Tinfoil API key.'),
  maxTextInputBytes: z.number().default(1048576).description('Maximum UTF-8 bytes accepted by redact_text.'),
  maxFileInputBytes: z.number().default(4194304).description('Maximum file size in bytes accepted by redact_file.'),
  maxResponseBytes: z.number().default(16777216).description('Maximum provider response body in bytes.'),
  requestTimeoutMs: z.number().default(120000).description('Redaction deadline in milliseconds, including attestation.'),
})

export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    apiKeyEnv: resolveApiKeyEnv(config.apiKeyEnv, 'tinfoil-pii: apiKeyEnv'),
    maxTextInputBytes: positiveInteger(config.maxTextInputBytes ?? 1048576, 'tinfoil-pii: maxTextInputBytes'),
    maxFileInputBytes: positiveInteger(config.maxFileInputBytes ?? 4194304, 'tinfoil-pii: maxFileInputBytes'),
    maxResponseBytes: positiveInteger(config.maxResponseBytes ?? 16777216, 'tinfoil-pii: maxResponseBytes'),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs ?? 120000, 'tinfoil-pii: requestTimeoutMs'),
  }
}
