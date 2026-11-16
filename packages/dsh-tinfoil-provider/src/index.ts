import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import {
  TINFOIL_ROUTER_CONFIG_REPO,
  TINFOIL_ROUTER_ORIGIN,
  registerTinfoilAttestation,
} from '@srmico/dsh-tinfoil-lib'
import { buildTinfoilAdapter } from './adapter.js'
import { Config, resolveConfig } from './config.js'
import type { Config as ProviderConfig } from './config.js'
import { buildPiModels, buildTinfoilProvider } from './provider.js'
import { TINFOIL_NATIVE_WEB_SEARCH } from './native-web-search.js'
import { SecureFetch } from './secure-fetch.js'

export { Config }
export type { Config as TinfoilProviderConfig } from './config.js'
export { TINFOIL_NATIVE_WEB_SEARCH } from './native-web-search.js'

export const name = 'tinfoil-provider'
export const inject = ['llm']

export function apply(ctx: Context, config: ProviderConfig = {}): void {
  const resolved = resolveConfig(config)
  if (resolved.webSearch.enabled) {
    ctx.provide(TINFOIL_NATIVE_WEB_SEARCH, { enabled: true, provider: resolved.provider })
  }
  const models = buildPiModels(resolved)
  const secureFetch = resolved.mode === 'sdk'
    ? new SecureFetch(resolved.baseURL, resolved.timeoutMs)
    : undefined
  const provider = buildTinfoilProvider(resolved, models, secureFetch)
  const adapter = buildTinfoilAdapter({ config: resolved, provider, ctx })
  ctx.llm.registerAdapter([resolved.provider], adapter)
  registerTinfoilAttestation(ctx, {
    id: 'provider',
    title: 'Tinfoil model provider',
    description: 'Attested inference through the Tinfoil router, local proxy, or explicit direct mode.',
    mode: resolved.mode,
    ...(resolved.mode === 'sdk'
      ? { configRepo: TINFOIL_ROUTER_CONFIG_REPO, enclaveURL: TINFOIL_ROUTER_ORIGIN }
      : { enclaveURL: resolved.baseURL }),
    read: () => secureFetch?.verification(),
    ...(secureFetch === undefined
      ? {}
      : { verify: async (signal: AbortSignal) => { await secureFetch.attest(signal) } }),
  })
}
