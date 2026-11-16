import { defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { Provider } from '@earendil-works/pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type { ResolvedConfig } from './config.js'

const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_REQUEST_IMAGES = 50
const IMAGE_OFFLOAD_COUNT_QUANTUM = 10
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

export interface TinfoilAdapterOptions {
  config: ResolvedConfig
  provider: Provider
  ctx: Context
}

/**
 * Build the DSH LLM adapter for the Tinfoil route.
 *
 * The profile is built once and returned by identity, so `PiAiAdapter` keeps
 * one immutable snapshot until the plugin itself is reloaded. The credential
 * is resolved per request from the launch environment; the profile names no
 * `apiKeyEnv` because this closure owns the reference.
 * @param options - resolved config, pi-ai provider, and plugin context.
 * @returns a ready-to-register adapter.
 */
export function buildTinfoilAdapter(options: TinfoilAdapterOptions): PiAiAdapter {
  const { config, provider, ctx } = options
  const profile: ResolvedPiAiProviderProfile = {
    provider: config.provider,
    displayName: config.displayName,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
    maxRequestImages: MAX_REQUEST_IMAGES,
    imageOffloadCountQuantum: IMAGE_OFFLOAD_COUNT_QUANTUM,
    requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: config.retryPolicy,
    piProvider: provider,
    modelErrors: new Map(),
    configuredMaxTokens: config.configuredMaxTokens,
    timeoutMs: config.timeoutMs,
    ...config.headers === undefined ? {} : { headers: config.headers },
  }
  const profiles = new Map<string, ResolvedPiAiProviderProfile>([[config.provider, profile]])

  return new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => {
      const key = process.env[config.apiKeyEnv]?.trim()
      if (key === undefined || key.length === 0) {
        throw new LlmError(
          `Tinfoil API key is not set. Export ${config.apiKeyEnv} or add it to $DSH_HOME/.env.`,
          'MISSING_CREDENTIAL',
        )
      }
      return key
    },
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider: route, model, reason }) => {
      ctx.logger.warn(
        `tinfoil-provider: unusable replay state for "${route}/${model}";`
        + ` sending provider-neutral content (${reason})`,
      )
    },
  })
}
