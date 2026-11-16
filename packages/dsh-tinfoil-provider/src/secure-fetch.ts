import type { SecureClient, VerificationDocument } from 'tinfoil'
import { LlmError } from '@deepseek-ai/dsh-llm'

type TinfoilModule = typeof import('tinfoil')
type FetchInput = Parameters<typeof globalThis.fetch>[0]

const ERROR_DETAIL_CHARS = 300
const UNSAFE_DETAIL = /[\u0000-\u001f\u007f]+/gu

/**
 * Attested fetch for pi-ai's OpenAI-compatible requests.
 *
 * The first request performs `SecureClient.ready()`; later requests reuse the
 * verified client. Each request forwards only its path to the client, so the
 * static model `baseUrl` never has to match the router origin the SDK
 * resolved during attestation.
 */
export class SecureFetch {
  private modulePromise: Promise<TinfoilModule> | undefined
  private client: SecureClient | undefined
  private readyPromise: Promise<void> | undefined

  constructor(
    private readonly baseURL: string,
    private readonly timeoutMs: number,
  ) {}

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const client = await this.clientReady(init?.signal ?? undefined)
    return client.fetch(this.pathOf(input), { ...init, redirect: 'error' })
  }

  /** Current verification document, or undefined before the first request. */
  verification(): VerificationDocument | undefined {
    return this.client?.getVerificationDocument()
  }

  /** Attest the inference enclave and return its verification document. */
  async attest(signal: AbortSignal): Promise<VerificationDocument> {
    const client = await this.clientReady(signal)
    return client.getVerificationDocument()
  }

  private async clientReady(signal: AbortSignal | undefined): Promise<SecureClient> {
    const module = await this.loadModule()
    const client = this.client ??= new module.SecureClient()
    let ready = this.readyPromise
    if (ready === undefined) {
      ready = client.ready().catch((error: unknown) => {
        this.readyPromise = undefined
        this.client?.reset()
        throw readyError(module, error)
      })
      this.readyPromise = ready
    }
    await this.awaitReady(ready, signal)
    return client
  }

  private async loadModule(): Promise<TinfoilModule> {
    if (this.modulePromise === undefined) {
      this.modulePromise = import('tinfoil').catch((error: unknown) => {
        this.modulePromise = undefined
        throw new LlmError(
          'The Tinfoil SDK could not be loaded. Reinstall the plugin or run pnpm install.',
          'UNKNOWN',
          { cause: error },
        )
      })
    }
    return this.modulePromise
  }

  private async awaitReady(ready: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let detach = (): void => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(combined.reason)
      combined.addEventListener('abort', onAbort, { once: true })
      detach = (): void => combined.removeEventListener('abort', onAbort)
    })
    try {
      await Promise.race([ready, aborted])
    } catch (error) {
      if (timeout.aborted) {
        throw new LlmError(
          `Tinfoil enclave attestation timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`,
          'TIMEOUT',
          { cause: error },
        )
      }
      throw error
    } finally {
      detach()
    }
  }

  private pathOf(input: FetchInput): string {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    try {
      const url = new URL(raw, this.baseURL)
      return `${url.pathname}${url.search}`
    } catch {
      return raw
    }
  }
}

function readyError(module: TinfoilModule, error: unknown): LlmError {
  const message = safeMessage(error)
  if (error instanceof module.AttestationError) {
    return new LlmError(
      `Tinfoil enclave attestation failed; no request was sent. ${message}`,
      'PI_AI_ERROR',
      { cause: error },
    )
  }
  if (error instanceof module.ConfigurationError) {
    return new LlmError(
      `Tinfoil client configuration failed: ${message}`,
      'INVALID_CONFIG',
      { cause: error },
    )
  }
  if (error instanceof module.TinfoilError) {
    return new LlmError(`Tinfoil client failed: ${message}`, 'TRANSPORT', { cause: error })
  }
  return new LlmError(`Could not reach Tinfoil: ${message}`, 'TRANSPORT', { cause: error })
}

function safeMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : 'unknown error'
  return value.replace(UNSAFE_DETAIL, ' ').replace(/\s+/gu, ' ').trim().slice(0, ERROR_DETAIL_CHARS)
}
