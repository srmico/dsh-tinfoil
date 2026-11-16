import type { Context } from '@deepseek-ai/cordis'
import {
  TINFOIL_PII_CONFIG_REPO,
  TINFOIL_PII_ORIGIN,
  registerTinfoilAttestation,
} from '@srmico/dsh-tinfoil-lib'
import { TinfoilPiiClient } from './client.js'
import { Config, resolveConfig } from './config.js'
import type { Config as PIIConfig } from './config.js'
import { registerRedactFile, registerRedactText } from './tools.js'

export { Config }
export type { Config as TinfoilPiiConfig } from './config.js'

export const name = 'tinfoil-pii'
export const inject = ['tools']

export function apply(ctx: Context, config: PIIConfig = {}): void {
  const resolved = resolveConfig(config)
  const client = new TinfoilPiiClient({
    apiKeyEnv: resolved.apiKeyEnv,
    maxResponseBytes: resolved.maxResponseBytes,
    requestTimeoutMs: resolved.requestTimeoutMs,
  })
  const dependencies = { config: resolved, client }
  registerTinfoilAttestation(ctx, {
    id: 'pii',
    title: 'PII redaction',
    description: 'SDK attestation for text and UTF-8 files.',
    mode: 'sdk',
    configRepo: TINFOIL_PII_CONFIG_REPO,
    enclaveURL: TINFOIL_PII_ORIGIN,
    read: () => client.verification(),
    verify: async (signal: AbortSignal) => { await client.attest(signal) },
  })
  registerRedactText(ctx, dependencies)
  ctx.inject(['fs', 'workingDirectory'], fileCtx => {
    registerRedactFile(fileCtx, dependencies)
  })
}
