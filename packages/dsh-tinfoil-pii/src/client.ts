import { Buffer } from 'node:buffer'
import {
  TINFOIL_PII_CONFIG_REPO,
  TINFOIL_PII_ORIGIN,
  TinfoilSecureClient,
  classifyHttpStatus,
  readProviderErrorBody,
  readTextCapped,
  responseTooLarge,
} from '@srmico/dsh-tinfoil-lib'
import type { TinfoilTransportErrorCode, VerificationDocument } from '@srmico/dsh-tinfoil-lib'
import { TinfoilPiiError } from './errors.js'
import { parseRedactionBody } from './payload.js'
import type { RedactionResult } from './payload.js'

const REDACT_PATH = '/redact'
const PROVIDER_JSON_LIMIT_BYTES = 4 * 1024 * 1024

export { TINFOIL_PII_CONFIG_REPO as PII_CONFIG_REPO, TINFOIL_PII_ORIGIN as PII_ENCLAVE_URL }

export interface TinfoilPiiClientOptions {
  apiKeyEnv: string
  maxResponseBytes: number
  requestTimeoutMs: number
}

export interface RedactInput {
  text: string
  signal: AbortSignal
}

function piiError(
  message: string,
  code: TinfoilTransportErrorCode,
  options?: ErrorOptions,
): TinfoilPiiError {
  return new TinfoilPiiError(message, code, options)
}

export class TinfoilPiiClient {
  private readonly client: TinfoilSecureClient
  private readonly options: TinfoilPiiClientOptions

  constructor(options: TinfoilPiiClientOptions) {
    this.options = options
    this.client = new TinfoilSecureClient({
      endpoint: {
        enclaveURL: TINFOIL_PII_ORIGIN,
        configRepo: TINFOIL_PII_CONFIG_REPO,
      },
      apiKeyEnv: options.apiKeyEnv,
      requestTimeoutMs: options.requestTimeoutMs,
      label: 'Tinfoil privacy filter',
      error: piiError,
    })
  }

  assertApiKey(): string {
    return this.client.assertApiKey()
  }

  async redact(input: RedactInput): Promise<RedactionResult> {
    this.client.assertApiKey()
    const body = this.serializeBody(input.text)
    const response = await this.client.request(REDACT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, input.signal)
    if (!response.ok) {
      const providerError = await readProviderErrorBody(response)
      throw this.httpError(response.status, providerError.code)
    }
    const text = await readTextCapped(response, {
      limit: this.options.maxResponseBytes,
      tooLarge: () => responseTooLarge(
        piiError,
        `Tinfoil privacy filter response exceeded ${this.options.maxResponseBytes} bytes; no redacted text was returned.`,
      ),
    })
    return parseRedactionBody(text)
  }

  private serializeBody(text: string): string {
    if (text.length === 0) {
      throw new TinfoilPiiError('The input must not be empty.', 'INPUT_EMPTY')
    }
    const body = JSON.stringify({ text })
    const bytes = Buffer.byteLength(body, 'utf8')
    if (bytes > PROVIDER_JSON_LIMIT_BYTES) {
      throw new TinfoilPiiError(
        `The redaction request is ${bytes} bytes, which exceeds the provider's 4 MiB JSON limit. Split the input into smaller segments at line or paragraph boundaries. Redaction is not applied across chunks, so an entity split between chunks can be missed.`,
        'INPUT_TOO_LARGE',
      )
    }
    return body
  }

  /** Current verification document, or undefined before this client is created. */
  verification(): VerificationDocument | undefined {
    return this.client.verification()
  }

  /** Attest the privacy-filter enclave and return its verification document. */
  async attest(signal: AbortSignal): Promise<VerificationDocument> {
    return await this.client.attest(signal)
  }

  private httpError(status: number, code?: string): TinfoilPiiError {
    switch (classifyHttpStatus(status, code)) {
      case 'auth':
        return new TinfoilPiiError(
          `Tinfoil privacy filter authentication failed (HTTP ${status}). Check ${this.options.apiKeyEnv}.`,
          'TINFOIL_AUTH_FAILED',
        )
      case 'billing':
        return new TinfoilPiiError(
          'Tinfoil account billing is paused (HTTP 402). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_BILLING_PAUSED',
        )
      case 'quota':
        return new TinfoilPiiError(
          'Tinfoil quota is exhausted (HTTP 429). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_QUOTA_EXCEEDED',
        )
      case 'too-large':
        return new TinfoilPiiError(
          'Tinfoil rejected the input as too large (HTTP 413). Split the input into smaller segments at line or paragraph boundaries. Redaction is not applied across chunks, so an entity split between chunks can be missed.',
          'INPUT_TOO_LARGE',
        )
      case 'rate-limit':
        return new TinfoilPiiError(
          'Tinfoil rate limit exceeded (HTTP 429). Retry later.',
          'TINFOIL_RATE_LIMITED',
        )
      case 'request-rejected':
        return new TinfoilPiiError(
          `Tinfoil rejected the redaction request (HTTP ${status}).`,
          'TINFOIL_REQUEST_REJECTED',
        )
      case 'unavailable':
        return new TinfoilPiiError(
          `Tinfoil privacy filter is unavailable (HTTP ${status}). Retry later.`,
          'TINFOIL_UNAVAILABLE',
        )
      default:
        return new TinfoilPiiError(
          `Tinfoil privacy filter failed (HTTP ${status}).`,
          'TINFOIL_REDACTION_FAILED',
        )
    }
  }
}
