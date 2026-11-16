import type { Context } from '@deepseek-ai/cordis'
import { registerTinfoilAttestation } from '@srmico/dsh-tinfoil-lib'
import { TinfoilAudioClient } from './client.js'
import { Config, resolveConfig } from './config.js'
import type { Config as AudioConfig } from './config.js'
import { registerSynthesizeSpeech, registerTranscribeAudio, registerTranscribeAudioToFile } from './tools.js'

export { Config }
export type { Config as TinfoilAudioConfig } from './config.js'

export const name = 'tinfoil-audio'
export const inject = ['tools']

export function apply(ctx: Context, config: AudioConfig = {}): void {
  const resolved = resolveConfig(config)
  const client = new TinfoilAudioClient({
    apiKeyEnv: resolved.apiKeyEnv,
    maxResponseBytes: resolved.maxResponseBytes,
    requestTimeoutMs: resolved.requestTimeoutMs,
    includeProviderErrorDetail: resolved.includeProviderErrorDetail,
  })
  const dependencies = { config: resolved, client }
  registerTinfoilAttestation(ctx, {
    id: 'audio',
    title: 'Audio transcription and speech',
    description: 'SDK attestation for transcription and speech synthesis.',
    mode: 'sdk',
    read: () => client.verification(),
    verify: async (signal: AbortSignal) => { await client.attest(signal) },
  })
  ctx.inject(['fs', 'workingDirectory'], fileCtx => {
    registerTranscribeAudio(fileCtx, dependencies)
    registerTranscribeAudioToFile(fileCtx, dependencies)
  })
  ctx.inject(['attachments'], attachmentCtx => {
    registerSynthesizeSpeech(attachmentCtx, dependencies)
  })
}
