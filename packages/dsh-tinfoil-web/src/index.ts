import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import {
  TINFOIL_WEBSEARCH_CONFIG_REPO,
  TINFOIL_WEBSEARCH_ORIGIN,
  registerTinfoilAttestation,
} from '@srmico/dsh-tinfoil-lib'
import { FetchBatcher } from './batcher.js'
import {
  Config,
  MAX_BATCH_URLS,
  TINFOIL_PROVIDER_ID,
  isEndpointMode,
  resolveConfig,
} from './config.js'
import type { Config as WebConfig } from './config.js'
import { TinfoilWebClient } from './mcp-client.js'
import { TinfoilFetchProvider, TinfoilSearchProvider } from './providers.js'

export { Config, TINFOIL_PROVIDER_ID }
export type { Config as TinfoilWebConfig } from './config.js'
export { FetchBatcher } from './batcher.js'
export { TinfoilWebClient } from './mcp-client.js'
export { TinfoilFetchProvider, TinfoilSearchProvider } from './providers.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tinfoil-web'

/**
 * Register the Tinfoil search and fetch providers once a web seam exists.
 *
 * The plugin deliberately has no top-level `inject`: in a composition without
 * `ctx.web` (for example a default sdk-minimal profile) it waits quietly, and a
 * later row that mounts the seam activates it. This keeps the root bundle
 * installable on every surface without forcing `dsh-web` into sdk-minimal.
 */
export function apply(ctx: Context, config: WebConfig = {}): void {
  const resolved = resolveConfig(config)
  ctx.inject(['web'], (webCtx) => {
    const client = new TinfoilWebClient(resolved)
    const batcher = new FetchBatcher(
      (urls, signal) => client.fetchPages(urls, signal),
      {
        transport: isEndpointMode(resolved) ? 'endpoint' : 'tinfoil',
        enabled: resolved.batchFetch,
        windowMs: resolved.batchWindowMs,
        maxUrls: MAX_BATCH_URLS,
        timeoutMs: resolved.requestTimeoutMs,
      },
    )
    const native = () => webCtx.get('tinfoilNativeWebSearch')
    webCtx.web.registerSearchProvider(new TinfoilSearchProvider(resolved, client, native))
    webCtx.web.registerFetchProvider(new TinfoilFetchProvider(resolved, batcher, native))
    const endpoint = resolved.endpoint
    registerTinfoilAttestation(webCtx, {
      id: 'web',
      title: 'Web search and fetch',
      description: 'Attested search and fetch, or an explicit unattested endpoint.',
      mode: endpoint === undefined ? 'sdk' : 'endpoint',
      ...(endpoint === undefined
        ? { configRepo: TINFOIL_WEBSEARCH_CONFIG_REPO, enclaveURL: TINFOIL_WEBSEARCH_ORIGIN }
        : { enclaveURL: endpoint }),
      read: () => client.verification(),
      ...(endpoint === undefined
        ? { verify: async (signal: AbortSignal) => { await client.attest(signal) } }
        : {}),
    })
    webCtx.effect(() => () => {
      batcher.close()
      void client.close()
    }, 'tinfoil web client')
  })
}
