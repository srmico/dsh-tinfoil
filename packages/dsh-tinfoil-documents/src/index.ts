import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import { registerTinfoilAttestation, TINFOIL_ROUTER_CONFIG_REPO, TINFOIL_ROUTER_ORIGIN } from '@srmico/dsh-tinfoil-lib'
import { ConversionCache } from './cache.js'
import { Config, resolveConfig } from './config.js'
import type { Config as DocumentsConfig } from './config.js'
import { readRedirectReason } from './documents.js'
import { registerReadDocument, registerReadDocumentAsImage } from './tools.js'
import { TinfoilConverter } from './tinfoil-client.js'

export { Config }
export type { Config as TinfoilDocumentsConfig } from './config.js'

export const name = 'tinfoil-documents'
export const inject = ['tools', 'fs', 'workingDirectory']

export function apply(ctx: Context, config: DocumentsConfig = {}): void {
  const resolved = resolveConfig(config)
  const converter = new TinfoilConverter({
    apiKeyEnv: resolved.apiKeyEnv,
    ...(resolved.endpoint === undefined ? {} : { endpoint: resolved.endpoint }),
    maxResponseBytes: resolved.maxResponseBytes,
    requestTimeoutMs: resolved.requestTimeoutMs,
    maxPages: resolved.maxPages,
    includeProviderErrorDetail: resolved.includeProviderErrorDetail,
  })
  const cache = new ConversionCache({
    root: resolved.cacheDir,
    identity: resolved.cacheIdentity,
    requireVerification: resolved.endpoint === undefined,
    maxBytes: resolved.maxCacheBytes,
    ttlMs: resolved.cacheTtlMs,
  })
  const imageToolAvailable = ctx.get('attachments') !== undefined && ctx.get('llm') !== undefined
  registerTinfoilAttestation(ctx, {
    id: 'documents',
    title: 'Document conversion',
    description: 'SDK attestation for PDF, DOCX, PPTX, XLSX, HTML, and CSV.',
    mode: resolved.endpoint === undefined ? 'sdk' : 'endpoint',
    ...(resolved.endpoint === undefined
      ? { configRepo: TINFOIL_ROUTER_CONFIG_REPO, enclaveURL: TINFOIL_ROUTER_ORIGIN }
      : { enclaveURL: resolved.endpoint }),
    read: () => converter.verification(),
    ...(resolved.endpoint === undefined
      ? { verify: async (signal: AbortSignal) => { await converter.attest(signal) } }
      : {}),
  })
  registerReadDocument(ctx, {
    config: resolved,
    cache,
    converter,
    imageToolAvailable,
  })
  ctx.inject(['attachments', 'llm'], imageCtx => {
    registerReadDocumentAsImage(imageCtx, {
      config: resolved,
      cache,
      converter,
      imageToolAvailable: true,
    })
  })
  ctx.tools.guard(exec => readRedirectReason(exec.name, exec.arguments))
  ctx.effect(() => () => {
    cache.dispose()
  }, 'tinfoil documents cache')
}
