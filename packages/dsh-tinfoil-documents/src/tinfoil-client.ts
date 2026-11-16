import {
  TinfoilEndpointClient,
  TinfoilSecureClient,
  classifyHttpStatus,
  readProviderErrorBody,
  readTextCapped,
  responseTooLarge,
  type TinfoilTransportErrorCode,
  type VerificationDocument,
} from '@srmico/dsh-tinfoil-lib'
import { TinfoilDocumentsError } from './errors.js'
import { parseConversionPayload } from './payload.js'
import type { ConvertedDocument } from './payload.js'

const CONVERT_PATH = '/v1/convert/file?mode=images'

export interface TinfoilConverterOptions {
  apiKeyEnv: string
  endpoint?: string
  maxResponseBytes: number
  requestTimeoutMs: number
  maxPages: number
  includeProviderErrorDetail?: boolean
}

export interface ConvertInput {
  data: Uint8Array
  filename: string
  mediaType: string
  signal: AbortSignal
}

function documentsError(
  message: string,
  code: TinfoilTransportErrorCode,
  options?: ErrorOptions,
): TinfoilDocumentsError {
  return new TinfoilDocumentsError(message, code, options)
}

export class TinfoilConverter {
  private readonly options: TinfoilConverterOptions
  private readonly secure: TinfoilSecureClient | undefined
  private readonly endpoint: TinfoilEndpointClient | undefined

  constructor(options: TinfoilConverterOptions) {
    this.options = options
    if (options.endpoint === undefined) {
      this.secure = new TinfoilSecureClient({
        apiKeyEnv: options.apiKeyEnv,
        requestTimeoutMs: options.requestTimeoutMs,
        label: 'Tinfoil document conversion',
        error: documentsError,
      })
      this.endpoint = undefined
    } else {
      this.secure = undefined
      this.endpoint = new TinfoilEndpointClient({
        baseURL: options.endpoint,
        requestTimeoutMs: options.requestTimeoutMs,
        label: 'Tinfoil document conversion',
        error: documentsError,
      })
    }
  }

  assertApiKey(): string {
    // A self-hosted endpoint does not use the Tinfoil API key.
    return this.secure?.assertApiKey() ?? ''
  }

  async convert(input: ConvertInput): Promise<ConvertedDocument> {
    this.assertApiKey()
    const form = new FormData()
    const bytes = input.data.slice()
    form.append('files', new Blob([bytes], { type: input.mediaType }), input.filename)
    const response = this.endpoint === undefined
      ? await this.secure!.request(CONVERT_PATH, { method: 'POST', body: form }, input.signal)
      : await this.endpoint.request(CONVERT_PATH, { method: 'POST', body: form }, input.signal)
    if (!response.ok) {
      const providerError = await readProviderErrorBody(response, {
        includeDetail: this.options.includeProviderErrorDetail === true,
      })
      throw this.httpError(response.status, providerError.code, providerError.detail)
    }
    const text = await readTextCapped(response, {
      limit: this.options.maxResponseBytes,
      tooLarge: () => responseTooLarge(
        documentsError,
        `Tinfoil document conversion response exceeded ${this.options.maxResponseBytes} bytes; no pages were cached. Raise maxResponseBytes or convert a smaller document.`,
      ),
    })
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch (error) {
      throw new TinfoilDocumentsError(
        'Tinfoil document conversion returned invalid JSON.',
        'TINFOIL_CONVERSION_FAILED',
        { cause: error },
      )
    }
    return parseConversionPayload(payload, { maxPages: this.options.maxPages })
  }

  /** Current verification document, or undefined before this client is created. */
  verification(): VerificationDocument | undefined {
    return this.secure?.verification()
  }

  /** Attest the document enclave and return its verification document. */
  async attest(signal: AbortSignal): Promise<VerificationDocument> {
    if (this.secure === undefined) {
      throw new TinfoilDocumentsError(
        'Self-hosted document conversion has no Tinfoil enclave to verify.',
        'TINFOIL_CONFIGURATION_FAILED',
      )
    }
    return await this.secure.attest(signal)
  }

  private httpError(status: number, code: string | undefined, detail: string): TinfoilDocumentsError {
    const suffix = detail.length > 0 ? `: ${detail}` : '.'
    switch (classifyHttpStatus(status, code)) {
      case 'auth':
        return new TinfoilDocumentsError(
          `Tinfoil authentication failed (HTTP ${status}). Check ${this.options.apiKeyEnv}.`,
          'TINFOIL_AUTH_FAILED',
        )
      case 'billing':
        return new TinfoilDocumentsError(
          'Tinfoil account billing is paused (HTTP 402). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_BILLING_PAUSED',
        )
      case 'quota':
        return new TinfoilDocumentsError(
          'Tinfoil quota is exhausted (HTTP 429). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_QUOTA_EXCEEDED',
        )
      case 'too-large':
        return new TinfoilDocumentsError(
          `Tinfoil rejected the document as too large (HTTP 413)${suffix}`,
          'DOCUMENT_TOO_LARGE',
        )
      case 'rate-limit':
        return new TinfoilDocumentsError(
          'Tinfoil rate limit exceeded (HTTP 429). Retry later.',
          'TINFOIL_RATE_LIMITED',
        )
      case 'request-rejected':
        return new TinfoilDocumentsError(
          `Tinfoil rejected the document conversion (HTTP ${status})${suffix}`,
          'TINFOIL_REQUEST_REJECTED',
        )
      case 'unavailable':
        return new TinfoilDocumentsError(
          `Tinfoil document conversion is unavailable (HTTP ${status}). Retry later.`,
          'TINFOIL_UNAVAILABLE',
        )
      default:
        return new TinfoilDocumentsError(
          `Tinfoil document conversion failed (HTTP ${status})${suffix}`,
          'TINFOIL_CONVERSION_FAILED',
        )
    }
  }
}
