import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import { raceWithSignal } from '@srmico/dsh-tinfoil-lib'
import type { VerificationDocument } from '@srmico/dsh-tinfoil-lib'
import {
  MAX_BATCH_URLS,
  TINFOIL_MCP_PATH,
  TINFOIL_WEB_CONFIG_REPO,
  TINFOIL_WEB_ORIGIN,
  isEndpointMode,
} from './config.js'
import type { ResolvedConfig } from './config.js'
import {
  abortedError,
  attestationFailed,
  endpointToolMissing,
  httpError,
  isAbortError,
  missingEndpointKey,
  missingTinfoilKey,
  providerFailure,
  responseTooLarge,
  sanitizeDetail,
  timeoutError,
  tinfoilConfigurationFailed,
  unavailable,
} from './errors.js'
import type { WebTransport } from './errors.js'
import {
  bindingFromTools,
  fetchArgs,
  mapFetch,
  mapSearch,
  searchArgs,
  tinfoilBinding,
} from './dialect.js'
import type { ToolBinding } from './dialect.js'
import { clampMaxResults } from './payload.js'
import type { PageOutcome, PageOutcomes, ToolResult } from './payload.js'

type McpModule = typeof import('@modelcontextprotocol/client')
type TinfoilModule = typeof import('tinfoil')
type McpClient = InstanceType<McpModule['Client']>
type McpTransport = InstanceType<McpModule['StreamableHTTPClientTransport']>
type SecureClient = InstanceType<TinfoilModule['SecureClient']>

type Operation = 'search' | 'fetch'

interface Generation {
  readonly client: McpClient
  readonly transport: McpTransport
  readonly binding: ToolBinding
  readonly available: readonly string[]
}

/**
 * MCP transport for the websearch capabilities.
 *
 * In attested mode every request goes through `SecureClient` bound to the
 * websearch enclave. In endpoint mode the request goes to the configured MCP
 * URL with a plain fetch and an optional Exa API key. The class owns the MCP
 * session, dialect binding, response cap, and error mapping.
 */
export class TinfoilWebClient {
  private mcpModule: McpModule | undefined
  private tinfoilModule: TinfoilModule | undefined
  private mcpPromise: Promise<McpModule> | undefined
  private tinfoilPromise: Promise<TinfoilModule> | undefined
  private secureClient: SecureClient | undefined
  private secureReady: Promise<void> | undefined
  private generation: Generation | undefined
  private opening: Promise<Generation> | undefined
  private closed = false

  constructor(private readonly options: ResolvedConfig) {}

  /**
   * Search through the bound provider.
   * @param query - non-empty query.
   * @param maxResults - consumer result cap.
   * @param signal - caller cancellation.
   * @returns the normalized search result.
   */
  async search(query: string, maxResults: number | undefined, signal: AbortSignal): Promise<WebSearchResult> {
    const clamped = clampMaxResults(maxResults)
    const deadline = this.deadline(signal)
    try {
      const generation = await this.ensure(deadline.signal)
      const spec = generation.binding.search
      if (spec === undefined) throw endpointToolMissing('search', generation.available)
      const result = await this.call(generation, spec.name, searchArgs(spec, query, clamped.maxResults), deadline.signal)
      return mapSearch(spec, result, clamped.maxResults, clamped.truncated)
    } catch (error) {
      throw this.fail(error, 'search', signal, deadline.timeout)
    }
  }

  /**
   * Fetch one or more URLs through the bound provider.
   * @param urls - validated URLs.
   * @param signal - caller cancellation.
   * @returns outcomes keyed by requested URL.
   */
  async fetchPages(urls: readonly string[], signal: AbortSignal): Promise<PageOutcomes> {
    if (urls.length === 0) return new Map()
    const deadline = this.deadline(signal)
    try {
      return await this.fetchChunks(urls, deadline.signal)
    } catch (error) {
      throw this.fail(error, 'fetch', signal, deadline.timeout)
    }
  }

  private async fetchChunks(urls: readonly string[], signal: AbortSignal): Promise<PageOutcomes> {
    if (urls.length > MAX_BATCH_URLS) {
      const merged = new Map<string, PageOutcome>()
      for (let index = 0; index < urls.length; index += MAX_BATCH_URLS) {
        const chunk = urls.slice(index, index + MAX_BATCH_URLS)
        const outcomes = await this.fetchChunks(chunk, signal)
        for (const [url, outcome] of outcomes) merged.set(url, outcome)
      }
      return merged
    }
    const generation = await this.ensure(signal)
    const spec = generation.binding.fetch
    if (spec === undefined) throw endpointToolMissing('fetch', generation.available)
    const result = await this.call(generation, spec.name, fetchArgs(spec, urls, this.options.maxPageChars), signal)
    return mapFetch(spec, result, urls, this.options.maxPageChars)
  }

  /** Close the MCP session; safe to call more than once. */
  async close(): Promise<void> {
    this.closed = true
    const generation = this.generation
    this.generation = undefined
    this.opening = undefined
    this.secureReady = undefined
    this.secureClient = undefined
    if (generation !== undefined) await closeQuietly(generation.client)
  }

  private transport(): WebTransport {
    return isEndpointMode(this.options) ? 'endpoint' : 'tinfoil'
  }

  private deadline(signal: AbortSignal): { signal: AbortSignal; timeout: AbortSignal } {
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs)
    return { signal: AbortSignal.any([signal, timeout]), timeout }
  }

  private fail(
    error: unknown,
    operation: Operation,
    callerSignal: AbortSignal,
    timeout: AbortSignal,
  ): WebError {
    if (this.isConnectionFailure(error)) this.resetGeneration()
    if (error instanceof WebError) return error
    return this.mapError(error, this.transport(), operation, callerSignal, timeout)
  }

  private async ensure(signal: AbortSignal): Promise<Generation> {
    if (this.closed) throw unavailable(this.transport())
    if (this.generation !== undefined) return this.generation
    let opening = this.opening
    if (opening === undefined) {
      opening = this.open(signal)
      this.opening = opening
    }
    try {
      const generation = await raceWithSignal(opening, signal)
      if (this.closed) {
        await closeQuietly(generation.client)
        throw unavailable(this.transport())
      }
      this.generation = generation
      return generation
    } finally {
      if (this.opening === opening) this.opening = undefined
    }
  }

  private async open(signal: AbortSignal): Promise<Generation> {
    return isEndpointMode(this.options) ? await this.openEndpoint(signal) : await this.openAttested(signal)
  }

  private async openEndpoint(signal: AbortSignal): Promise<Generation> {
    const endpoint = this.options.endpoint
    if (endpoint === undefined) throw providerFailure('No endpoint is configured.')
    const mcp = await this.loadMcp()
    const client = new mcp.Client({ name: 'dsh-tinfoil-web', version: '0.1.0' }, { capabilities: {} })
    const transport = new mcp.StreamableHTTPClientTransport(new URL(endpoint), { fetch: this.endpointFetch() })
    try {
      await raceWithSignal(client.connect(transport, { signal }), signal)
      const listed = await raceWithSignal(client.listTools(undefined, { signal }), signal)
      const names = listed.tools.map(tool => tool.name)
      return { client, transport, binding: bindingFromTools(new Set(names)), available: names }
    } catch (error) {
      await closeQuietly(client)
      throw error
    }
  }

  private async openAttested(signal: AbortSignal): Promise<Generation> {
    const mcp = await this.loadMcp()
    const secure = await this.ensureSecure(signal)
    const base = secure.getBaseURL()
    if (base === undefined) throw tinfoilConfigurationFailed('The attested client did not resolve a base URL.')
    const client = new mcp.Client({ name: 'dsh-tinfoil-web', version: '0.1.0' }, { capabilities: {} })
    const transport = new mcp.StreamableHTTPClientTransport(new URL(TINFOIL_MCP_PATH, base), {
      fetch: this.attestedFetch(secure),
    })
    try {
      await raceWithSignal(client.connect(transport, { signal }), signal)
    } catch (error) {
      await closeQuietly(client)
      throw error
    }
    return { client, transport, binding: tinfoilBinding(), available: ['search', 'fetch'] }
  }

  private async ensureSecure(signal: AbortSignal): Promise<SecureClient> {
    const tinfoil = await this.loadTinfoil()
    const secure = this.secureClient ??= new tinfoil.SecureClient({
      enclaveURL: TINFOIL_WEB_ORIGIN,
      configRepo: TINFOIL_WEB_CONFIG_REPO,
    })
    await this.awaitSecureReady(secure, signal)
    return secure
  }

  /** Current verification document, or undefined before the attested client exists. */
  verification(): VerificationDocument | undefined {
    return this.secureClient?.getVerificationDocument()
  }

  /** Attest the websearch enclave and return its verification document. */
  async attest(signal: AbortSignal): Promise<VerificationDocument> {
    return (await this.ensureSecure(signal)).getVerificationDocument()
  }

  private async call(
    generation: Generation,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    try {
      const result = await raceWithSignal(
        generation.client.callTool({ name, arguments: args }, { signal }),
        signal,
      )
      return result as unknown as ToolResult
    } catch (error) {
      if (this.isConnectionFailure(error)) this.resetGeneration()
      throw error
    }
  }

  private async awaitSecureReady(secure: SecureClient, signal: AbortSignal): Promise<void> {
    let ready = this.secureReady
    if (ready === undefined) {
      ready = secure.ready().catch((error: unknown) => {
        this.secureReady = undefined
        this.secureClient = undefined
        secure.reset()
        throw error
      })
      this.secureReady = ready
    }
    await raceWithSignal(ready, signal)
  }

  private async loadMcp(): Promise<McpModule> {
    if (this.mcpModule !== undefined) return this.mcpModule
    this.mcpPromise ??= import('@modelcontextprotocol/client').then((module) => {
      this.mcpModule = module
      return module
    }).catch((error: unknown) => {
      this.mcpPromise = undefined
      throw unavailable(
        this.transport(),
        'The MCP client could not be loaded. Run pnpm install and rebuild the plugin.',
        error,
      )
    })
    return await this.mcpPromise
  }

  private async loadTinfoil(): Promise<TinfoilModule> {
    if (this.tinfoilModule !== undefined) return this.tinfoilModule
    this.tinfoilPromise ??= import('tinfoil').then((module) => {
      this.tinfoilModule = module
      return module
    }).catch((error: unknown) => {
      this.tinfoilPromise = undefined
      throw unavailable(
        'tinfoil',
        'The Tinfoil SDK could not be loaded. Run pnpm install and rebuild the plugin.',
        error,
      )
    })
    return await this.tinfoilPromise
  }

  private attestedFetch(secure: SecureClient): typeof globalThis.fetch {
    return async (input, init) => {
      const headers = this.requestHeaders(init?.headers, 'tinfoil')
      const response = await secure.fetch(input, { ...init, headers, redirect: 'error' })
      return await capResponse(response, this.options.maxResponseBytes, 'tinfoil')
    }
  }

  private endpointFetch(): typeof globalThis.fetch {
    return async (input, init) => {
      const headers = this.requestHeaders(init?.headers, 'endpoint')
      const response = await fetch(input, { ...init, headers, redirect: 'error' })
      return await capResponse(response, this.options.maxResponseBytes, 'endpoint')
    }
  }

  private requestHeaders(init: RequestInit['headers'], transport: WebTransport): Headers {
    const headers = new Headers(init)
    if (transport === 'tinfoil') {
      const key = process.env[this.options.apiKeyEnv]?.trim()
      if (key === undefined || key.length === 0) throw missingTinfoilKey(this.options.apiKeyEnv)
      headers.set('authorization', `Bearer ${key}`)
      headers.set('x-tinfoil-tool-pii-check', this.options.piiCheck ? 'true' : 'false')
      headers.set('x-tinfoil-tool-injection-check', this.options.injectionCheck ? 'true' : 'false')
      return headers
    }
    const env = this.options.endpointApiKeyEnv
    if (env !== undefined) {
      const key = process.env[env]?.trim()
      if (key === undefined || key.length === 0) throw missingEndpointKey(env)
      headers.set('x-api-key', key)
    }
    return headers
  }

  private isConnectionFailure(error: unknown): boolean {
    const mcp = this.mcpModule
    if (mcp === undefined) return false
    return error instanceof mcp.SdkError
      && !(error instanceof mcp.SdkHttpError)
      && !(error instanceof mcp.UnauthorizedError)
  }

  private resetGeneration(): void {
    const generation = this.generation
    this.generation = undefined
    if (generation !== undefined) void closeQuietly(generation.client)
  }

  private mapError(
    error: unknown,
    transport: WebTransport,
    operation: Operation,
    signal: AbortSignal,
    timeout?: AbortSignal,
  ): WebError {
    if (error instanceof WebError) return error
    if (signal.aborted) return abortedError(operation, signal.reason)
    if (timeout?.aborted) {
      return timeoutError(transport, operation, Math.max(1, Math.round(this.options.requestTimeoutMs / 1000)))
    }
    if (isAbortError(error)) return abortedError(operation, error)
    const mcp = this.mcpModule
    if (mcp !== undefined) {
      if (error instanceof mcp.UnauthorizedError) return httpError(transport, 401, '')
      if (error instanceof mcp.SdkHttpError) return httpError(transport, error.status, '')
      if (error instanceof mcp.SdkError) return unavailable(transport, undefined, error)
    }
    const tinfoil = this.tinfoilModule
    if (tinfoil !== undefined) {
      if (error instanceof tinfoil.AttestationError) {
        return attestationFailed(sanitizeDetail(error.message), error)
      }
      if (error instanceof tinfoil.ConfigurationError) {
        return tinfoilConfigurationFailed(sanitizeDetail(error.message), error)
      }
      if (error instanceof tinfoil.TinfoilError) return unavailable(transport, undefined, error)
    }
    return providerFailure(undefined, error)
  }
}

async function closeQuietly(client: McpClient): Promise<void> {
  try {
    await client.close()
  } catch {
    // A failed close must not mask the operation's own failure.
  }
}

async function capResponse(response: Response, limit: number, transport: WebTransport): Promise<Response> {
  if (response.body === null || response.status === 204 || response.status === 205 || response.status === 304) {
    return response
  }
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > limit) {
      await response.body.cancel().catch(() => {})
      throw responseTooLarge(transport, limit)
    }
  }
  const reader = response.body.getReader()
  let total = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>
      try {
        chunk = await reader.read()
      } catch (error) {
        controller.error(error)
        return
      }
      if (chunk.done || chunk.value === undefined) {
        controller.close()
        return
      }
      total += chunk.value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        controller.error(responseTooLarge(transport, limit))
        return
      }
      controller.enqueue(chunk.value)
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
