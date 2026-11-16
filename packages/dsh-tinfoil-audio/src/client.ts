import {
  TinfoilSecureClient,
  classifyHttpStatus,
  readBytesCapped,
  readProviderErrorBody,
  readTextCapped,
  type TinfoilTransportErrorCode,
  type VerificationDocument,
} from '@srmico/dsh-tinfoil-lib'
import { audioExtensionForMediaType, parseContentType, sniffAudioMediaType, wavDurationSeconds } from './audio.js'
import type { SpeechFormat, TranscriptFormat } from './config.js'
import { TinfoilAudioError } from './errors.js'
import { parseTranscriptionBody } from './payload.js'

const TRANSCRIBE_PATH = '/v1/audio/transcriptions'
const SPEECH_PATH = '/v1/audio/speech'
const AUDIO_PREFIX_BYTES = 65536

export interface TinfoilAudioClientOptions {
  apiKeyEnv: string
  maxResponseBytes: number
  requestTimeoutMs: number
  includeProviderErrorDetail?: boolean
}

export interface TranscribeInput {
  data: Uint8Array
  filename: string
  mediaType: string
  model: string
  language?: string
  prompt?: string
  temperature?: number
  responseFormat: TranscriptFormat
  signal: AbortSignal
}

export interface TranscriptionResult {
  text: string
  raw: string
}

export interface SpeechRequest {
  text: string
  model: string
  voice: string
  responseFormat: SpeechFormat
  signal: AbortSignal
}

export interface SpeechResult {
  data: Uint8Array
  mediaType: string
  extension: string
  durationSeconds?: number
}

function audioError(
  message: string,
  code: TinfoilTransportErrorCode,
  options?: ErrorOptions,
): TinfoilAudioError {
  return new TinfoilAudioError(message, code, options)
}

function invalidResponse(): TinfoilAudioError {
  return new TinfoilAudioError('Tinfoil audio returned an unexpected response.', 'TINFOIL_RESPONSE_INVALID')
}

function parseDurationHeader(value: string | null): number | undefined {
  if (value === null) return undefined
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : undefined
}

export class TinfoilAudioClient {
  private readonly client: TinfoilSecureClient
  private readonly options: TinfoilAudioClientOptions

  constructor(options: TinfoilAudioClientOptions) {
    this.options = options
    this.client = new TinfoilSecureClient({
      apiKeyEnv: options.apiKeyEnv,
      requestTimeoutMs: options.requestTimeoutMs,
      label: 'Tinfoil audio',
      error: audioError,
    })
  }

  assertApiKey(): string {
    return this.client.assertApiKey()
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    this.client.assertApiKey()
    const form = new FormData()
    const bytes = input.data.slice()
    form.append('file', new Blob([bytes], { type: input.mediaType }), input.filename)
    form.append('model', input.model)
    if (input.language !== undefined) form.append('language', input.language)
    if (input.prompt !== undefined) form.append('prompt', input.prompt)
    if (input.temperature !== undefined) form.append('temperature', String(input.temperature))
    form.append('response_format', input.responseFormat)
    const response = await this.client.request(TRANSCRIBE_PATH, {
      method: 'POST',
      body: form,
    }, input.signal)
    if (!response.ok) {
      const providerError = await readProviderErrorBody(response, {
        includeDetail: this.options.includeProviderErrorDetail === true,
      })
      throw this.httpError(response.status, providerError.code, providerError.detail)
    }
    if (parseContentType(response.headers.get('content-type')) === 'text/html') throw invalidResponse()
    const text = await readTextCapped(response, {
      limit: this.options.maxResponseBytes,
      tooLarge: () => this.responseTooLarge(),
    })
    return { text: parseTranscriptionBody(text, input.responseFormat), raw: text }
  }

  async synthesize(input: SpeechRequest): Promise<SpeechResult> {
    this.client.assertApiKey()
    const body = JSON.stringify({
      model: input.model,
      voice: input.voice,
      input: input.text,
      response_format: input.responseFormat,
    })
    const response = await this.client.request(SPEECH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, input.signal)
    if (!response.ok) {
      const providerError = await readProviderErrorBody(response, {
        includeDetail: this.options.includeProviderErrorDetail === true,
      })
      throw this.httpError(response.status, providerError.code, providerError.detail)
    }
    const contentType = parseContentType(response.headers.get('content-type'))
    const data = await readBytesCapped(response, {
      limit: this.options.maxResponseBytes,
      tooLarge: () => this.responseTooLarge(),
    })
    if (data.byteLength === 0) throw invalidResponse()
    const mediaType = sniffAudioMediaType(data.subarray(0, AUDIO_PREFIX_BYTES), contentType)
    if (mediaType === undefined) throw invalidResponse()
    const duration = parseDurationHeader(response.headers.get('x-audio-duration-seconds'))
      ?? wavDurationSeconds(data)
    return {
      data,
      mediaType,
      extension: audioExtensionForMediaType(mediaType),
      ...(duration === undefined ? {} : { durationSeconds: duration }),
    }
  }

  /** Current verification document, or undefined before this client is created. */
  verification(): VerificationDocument | undefined {
    return this.client.verification()
  }

  /** Attest the audio enclave and return its verification document. */
  async attest(signal: AbortSignal): Promise<VerificationDocument> {
    return await this.client.attest(signal)
  }

  private responseTooLarge(): TinfoilAudioError {
    return new TinfoilAudioError(
      `Tinfoil audio response exceeded ${this.options.maxResponseBytes} bytes; no result was returned. Raise maxResponseBytes or use a shorter input.`,
      'TINFOIL_RESPONSE_TOO_LARGE',
    )
  }

  private httpError(status: number, code: string | undefined, detail: string): TinfoilAudioError {
    const suffix = detail.length > 0 ? `: ${detail}` : '.'
    switch (classifyHttpStatus(status, code)) {
      case 'auth':
        return new TinfoilAudioError(
          `Tinfoil audio authentication failed (HTTP ${status}). Check ${this.options.apiKeyEnv}.`,
          'TINFOIL_AUTH_FAILED',
        )
      case 'billing':
        return new TinfoilAudioError(
          'Tinfoil account billing is paused (HTTP 402). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_BILLING_PAUSED',
        )
      case 'quota':
        return new TinfoilAudioError(
          'Tinfoil quota is exhausted (HTTP 429). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_QUOTA_EXCEEDED',
        )
      case 'too-large':
        return new TinfoilAudioError(
          'Tinfoil rejected the audio as too large (HTTP 413). The provider may cap uploads at 25 MB; use a shorter or more compressed file.',
          'INPUT_TOO_LARGE',
        )
      case 'rate-limit':
        return new TinfoilAudioError(
          'Tinfoil rate limit exceeded (HTTP 429). Retry later.',
          'TINFOIL_RATE_LIMITED',
        )
      case 'request-rejected':
        return new TinfoilAudioError(
          `Tinfoil rejected the audio request (HTTP ${status})${suffix}`,
          'TINFOIL_REQUEST_REJECTED',
        )
      case 'unavailable':
        return new TinfoilAudioError(
          `Tinfoil audio is unavailable (HTTP ${status}). Retry later.`,
          'TINFOIL_UNAVAILABLE',
        )
      default:
        return new TinfoilAudioError(
          `Tinfoil audio failed (HTTP ${status})${suffix}`,
          'TINFOIL_AUDIO_FAILED',
        )
    }
  }
}
