import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import type { TinfoilNativeWebSearchService } from '@srmico/dsh-tinfoil-lib'
import { abortedError, providerFailure } from './errors.js'
import { TINFOIL_PROVIDER_ID, hasEndpointApiKey, hasTinfoilApiKey, isEndpointMode } from './config.js'
import type { ResolvedConfig } from './config.js'
import type { FetchBatcher } from './batcher.js'
import { validateFetchUrl } from './payload.js'
import type { TinfoilWebClient } from './mcp-client.js'

/** Reads the provider's native-search capability, when present. */
export type NativeWebSearchLookup = () => TinfoilNativeWebSearchService | undefined

const NEVER_ABORTED = new AbortController().signal

function available(config: ResolvedConfig): boolean {
  return isEndpointMode(config) ? hasEndpointApiKey(config) : hasTinfoilApiKey(config)
}

function ready(
  config: ResolvedConfig,
  native: NativeWebSearchLookup,
  llmProvider: string | undefined,
): boolean {
  const nativeState = native()
  if (nativeState?.enabled === true && llmProvider === nativeState.provider) return false
  return available(config)
}

/**
 * `ctx.web` search provider backed by the attested websearch server or an
 * Exa/local MCP endpoint.
 */
export class TinfoilSearchProvider implements WebSearchProvider {
  readonly id = TINFOIL_PROVIDER_ID

  constructor(
    private readonly config: ResolvedConfig,
    private readonly client: TinfoilWebClient,
    private readonly native: NativeWebSearchLookup,
  ) {}

  available(): boolean {
    return available(this.config)
  }

  async ready(llmProvider: string | undefined): Promise<boolean> {
    return ready(this.config, this.native, llmProvider)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const active = signal ?? NEVER_ABORTED
    if (active.aborted) throw abortedError('search', active.reason)
    if (request.query.trim().length === 0) throw providerFailure('The search query must not be empty.')
    return await this.client.search(request.query.trim(), request.maxResults, active)
  }
}

/**
 * `ctx.web` fetch provider backed by the same server, with concurrent calls
 * coalesced into one multi-URL request.
 */
export class TinfoilFetchProvider implements WebFetchProvider {
  readonly id = TINFOIL_PROVIDER_ID

  constructor(
    private readonly config: ResolvedConfig,
    private readonly batcher: FetchBatcher,
    private readonly native: NativeWebSearchLookup,
  ) {}

  available(): boolean {
    return available(this.config)
  }

  async ready(llmProvider: string | undefined): Promise<boolean> {
    return ready(this.config, this.native, llmProvider)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const active = signal ?? NEVER_ABORTED
    if (active.aborted) throw abortedError('fetch', active.reason)
    const url = validateFetchUrl(request.url)
    return await this.batcher.request(url, active)
  }
}
