import type { VerificationDocument } from 'tinfoil'
import type { TinfoilError, TinfoilErrorFactory } from './errors.js'
import { TinfoilError as TinfoilBaseError } from './errors.js'
import { errorDetail, raceWithSignal, sanitizeDetail } from './http.js'

type TinfoilModule = typeof import('tinfoil')
type SecureClient = InstanceType<TinfoilModule['SecureClient']>

/** Enclave identity for one attested service. */
export interface TinfoilAttestedEndpoint {
  readonly baseURL?: string
  readonly enclaveURL?: string
  readonly configRepo?: string
}

export interface TinfoilSecureClientOptions {
  readonly endpoint?: TinfoilAttestedEndpoint
  readonly apiKeyEnv: string
  readonly requestTimeoutMs: number
  /** Prefix used in model-visible error messages, for example `Tinfoil audio`. */
  readonly label: string
  readonly error: TinfoilErrorFactory
}

export interface TinfoilEndpointClientOptions {
  readonly baseURL: string
  readonly requestTimeoutMs: number
  readonly label: string
  readonly error: TinfoilErrorFactory
}

function timeoutSeconds(ms: number): number {
  return Math.max(1, Math.round(ms / 1000))
}

function mapSdkError(
  module: TinfoilModule,
  error: unknown,
  label: string,
  fail: TinfoilErrorFactory,
): TinfoilError {
  const message = errorDetail(error)
  if (error instanceof module.AttestationError) {
    return fail(
      `${label} enclave attestation failed; no request body was sent. ${message}`,
      'TINFOIL_ATTESTATION_FAILED',
      { cause: error },
    )
  }
  if (error instanceof module.ConfigurationError) {
    return fail(
      `${label} client configuration failed: ${message}`,
      'TINFOIL_CONFIGURATION_FAILED',
      { cause: error },
    )
  }
  if (error instanceof module.TinfoilError) {
    return fail(`${label} client failed: ${message}`, 'TINFOIL_UNAVAILABLE', { cause: error })
  }
  return fail(`Could not reach Tinfoil: ${message}`, 'TINFOIL_UNAVAILABLE', { cause: error })
}

function sdkModuleError(fail: TinfoilErrorFactory, error: unknown): TinfoilError {
  return fail(
    'The Tinfoil SDK could not be loaded. Run pnpm install and rebuild the plugin.',
    'TINFOIL_UNAVAILABLE',
    { cause: error },
  )
}

/**
 * Authenticated client for one attested Tinfoil endpoint.
 *
 * Owns the lazy SDK import, client identity, timeout composition, auth header,
 * redirect policy, and error mapping. Endpoint-specific request bodies and
 * response parsing stay in the plugin.
 */
export class TinfoilSecureClient {
  private modulePromise: Promise<TinfoilModule> | undefined
  private client: SecureClient | undefined

  constructor(private readonly options: TinfoilSecureClientOptions) {}

  /** Read and validate the configured API key. */
  assertApiKey(): string {
    const key = process.env[this.options.apiKeyEnv]?.trim()
    if (key === undefined || key.length === 0) {
      throw this.options.error(
        `Tinfoil API key is not set. Export ${this.options.apiKeyEnv} or add it to $DSH_HOME/.env.`,
        'TINFOIL_API_KEY_MISSING',
      )
    }
    return key
  }

  /** Run one authenticated request with a deadline and abort propagation. */
  async request(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
    auth = true,
    timeoutMs?: number,
  ): Promise<Response> {
    const deadlineMs = timeoutMs ?? this.options.requestTimeoutMs
    const timeout = AbortSignal.timeout(deadlineMs)
    const combined = AbortSignal.any([signal, timeout])
    let module: TinfoilModule | undefined
    try {
      const loaded = await this.loadModule()
      module = loaded
      const client = this.ensureClient(loaded)
      await this.awaitReady(client, combined)
      const headers = new Headers(init.headers)
      if (auth) headers.set('Authorization', `Bearer ${this.assertApiKey()}`)
      return await client.fetch(path, {
        ...init,
        headers,
        redirect: 'error',
        signal: combined,
      })
    } catch (error) {
      if (error instanceof TinfoilBaseError) throw error
      signal.throwIfAborted()
      if (timeout.aborted) {
        throw this.options.error(
          `${this.options.label} timed out after ${timeoutSeconds(deadlineMs)} seconds.`,
          'TINFOIL_TIMEOUT',
          { cause: error },
        )
      }
      if (module === undefined) {
        throw this.options.error(
          `Could not reach Tinfoil: ${errorDetail(error)}`,
          'TINFOIL_UNAVAILABLE',
          { cause: error },
        )
      }
      throw mapSdkError(module, error, this.options.label, this.options.error)
    }
  }

  /** Complete attestation and resolve once the client is usable. */
  async ready(signal: AbortSignal): Promise<void> {
    const module = await this.loadModule()
    const client = this.ensureClient(module)
    try {
      await this.awaitReady(client, signal)
    } catch (error) {
      if (error instanceof TinfoilBaseError) throw error
      signal.throwIfAborted()
      throw mapSdkError(module, error, this.options.label, this.options.error)
    }
  }

  /** Current verification document, or undefined before the client is created. */
  verification(): VerificationDocument | undefined {
    return this.client?.getVerificationDocument()
  }

  /** Attest this client's enclave and return its verification document. */
  async attest(signal: AbortSignal): Promise<VerificationDocument> {
    const module = await this.loadModule()
    const client = this.ensureClient(module)
    try {
      await this.awaitReady(client, signal)
    } catch (error) {
      if (error instanceof TinfoilBaseError) throw error
      signal.throwIfAborted()
      throw mapSdkError(module, error, this.options.label, this.options.error)
    }
    return client.getVerificationDocument()
  }

  private async loadModule(): Promise<TinfoilModule> {
    this.modulePromise ??= import('tinfoil')
    try {
      return await this.modulePromise
    } catch (error) {
      this.modulePromise = undefined
      throw sdkModuleError(this.options.error, error)
    }
  }

  private ensureClient(module: TinfoilModule): SecureClient {
    if (this.client !== undefined) return this.client
    const endpoint = this.options.endpoint
    this.client = endpoint === undefined
      ? new module.SecureClient()
      : new module.SecureClient({
        ...(endpoint.baseURL === undefined ? {} : { baseURL: endpoint.baseURL }),
        ...(endpoint.enclaveURL === undefined ? {} : { enclaveURL: endpoint.enclaveURL }),
        ...(endpoint.configRepo === undefined ? {} : { configRepo: endpoint.configRepo }),
      })
    return this.client
  }

  private async awaitReady(client: SecureClient, signal: AbortSignal): Promise<void> {
    const ready = client.ready()
    ready.catch(() => {})
    await raceWithSignal(ready, signal)
  }
}

/**
 * Client for an explicit unattested HTTP endpoint.
 *
 * Used by the documents plugin's self-hosted mode. It never adds an auth header.
 */
export class TinfoilEndpointClient {
  constructor(private readonly options: TinfoilEndpointClientOptions) {}

  /** Run one request against the configured base URL. */
  async request(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    try {
      return await fetch(`${this.options.baseURL}${path}`, {
        ...init,
        redirect: 'error',
        signal: combined,
      })
    } catch (error) {
      signal.throwIfAborted()
      if (timeout.aborted) {
        throw this.options.error(
          `${this.options.label} timed out after ${timeoutSeconds(this.options.requestTimeoutMs)} seconds.`,
          'TINFOIL_TIMEOUT',
          { cause: error },
        )
      }
      throw this.options.error(
        `Could not reach Tinfoil: ${sanitizeDetail(errorDetail(error))}`,
        'TINFOIL_UNAVAILABLE',
        { cause: error },
      )
    }
  }
}
