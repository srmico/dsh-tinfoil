import type { Context } from '@deepseek-ai/cordis'
import { registerTinfoilAttestation } from '@srmico/dsh-tinfoil-lib'
import { TinfoilDecisionsClient } from './client.js'
import { Config, resolveConfig } from './config.js'
import type { Config as DecisionsConfig } from './config.js'
import { registerDecisionGate } from './gate.js'
import { registerDecisionsTool } from './tools.js'

export { Config }
export type { Config as TinfoilDecisionsConfig } from './config.js'

export const name = 'tinfoil-decisions'
export const inject = ['tools']

export function apply(ctx: Context, config: DecisionsConfig = {}): void {
  const resolved = resolveConfig(config)
  const client = new TinfoilDecisionsClient({
    apiKeyEnv: resolved.apiKeyEnv,
    defaultModel: resolved.model,
    maxInputBytes: resolved.maxInputBytes,
    maxQuestions: resolved.maxQuestions,
    maxChoices: resolved.maxChoices,
    maxScoreLevels: resolved.maxScoreLevels,
    maxRequestBytes: resolved.maxRequestBytes,
    maxResponseBytes: resolved.maxResponseBytes,
    requestTimeoutMs: resolved.requestTimeoutMs,
  })
  const dependencies = { config: resolved, client }
  registerTinfoilAttestation(ctx, {
    id: 'decisions',
    title: 'Decision outputs',
    description: 'SDK attestation for typed questions and calibrated probabilities.',
    mode: 'sdk',
    read: () => client.verification(),
    verify: async (signal: AbortSignal) => { await client.attest(signal) },
  })
  registerDecisionsTool(ctx, dependencies)
  registerDecisionGate(ctx, dependencies)
}
