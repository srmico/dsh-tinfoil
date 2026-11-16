import { Buffer } from 'node:buffer'
import type { TinfoilError, TinfoilErrorFactory } from './errors.js'

const DEFAULT_DETAIL_CHARS = 300
const DEFAULT_ERROR_DETAIL_BYTES = 4096
const UNSAFE_DETAIL = /[\u0000-\u001f\u007f]+/gu

/** Bound and flatten a provider or SDK detail for model-visible output. */
export function sanitizeDetail(value: unknown, maxChars = DEFAULT_DETAIL_CHARS): string {
  const text = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : value === undefined || value === null
        ? ''
        : String(value)
  return text.replace(UNSAFE_DETAIL, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxChars)
}

/** Sanitized message of an error, or `unknown error`. */
export function errorDetail(error: unknown): string {
  return error instanceof Error ? sanitizeDetail(error.message) : 'unknown error'
}

/** Whether a thrown value is an abort. */
export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
}

/** Race a promise against an optional cancellation signal. */
export async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return await promise
  signal.throwIfAborted()
  let detach = (): void => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    detach = (): void => signal.removeEventListener('abort', onAbort)
    if (signal.aborted) onAbort()
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    detach()
  }
}

/** How one response cap reports its failure. */
export interface ResponseLimitOptions {
  readonly limit: number
  readonly tooLarge: () => TinfoilError
}

async function readCapped(response: Response, options: ResponseLimitOptions): Promise<Uint8Array> {
  const limit = options.limit
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader !== null) {
    const length = Number(lengthHeader)
    if (Number.isFinite(length) && length > limit) {
      const body = response.body
      if (body !== null) await body.cancel().catch(() => {})
      throw options.tooLarge()
    }
  }
  const body = response.body
  if (body === null) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw options.tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // The stream is already closed or cancelled.
    }
  }
  return Buffer.concat(chunks, total)
}

/** Read a bounded response body as UTF-8 text. */
export async function readTextCapped(response: Response, options: ResponseLimitOptions): Promise<string> {
  return Buffer.from(await readCapped(response, options)).toString('utf8')
}

/** Read a bounded response body as bytes. */
export async function readBytesCapped(response: Response, options: ResponseLimitOptions): Promise<Uint8Array> {
  return await readCapped(response, options)
}

/** Read at most `maxBytes` from a response body, cancelling the remainder. */
export async function readTextPrefix(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (body === null) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      const remaining = maxBytes - total
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(chunk)
      total += chunk.byteLength
      if (chunk.byteLength < value.byteLength) {
        await reader.cancel()
        break
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // The stream is already closed or cancelled.
    }
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

/** One bounded provider error body. */
export interface ProviderErrorBody {
  /** Provider error code/type, for example `insufficient_quota`. */
  readonly code?: string
  /** Sanitized provider detail; empty unless detail was requested. */
  readonly detail: string
}

export interface ProviderErrorBodyOptions {
  readonly includeDetail?: boolean
  readonly limitBytes?: number
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read one provider error body once: always extract a bounded error code,
 * include the detail only when requested.
 */
export async function readProviderErrorBody(
  response: Response,
  options: ProviderErrorBodyOptions = {},
): Promise<ProviderErrorBody> {
  const text = await readTextPrefix(response, options.limitBytes ?? DEFAULT_ERROR_DETAIL_BYTES)
  let code: string | undefined
  let detail: string | undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      code = stringField(record.code) ?? stringField(record.type)
      const error = record.error
      if (typeof error === 'string') {
        detail = error
      } else if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
        const nested = error as Record<string, unknown>
        code = stringField(nested.code) ?? stringField(nested.type) ?? code
        detail = stringField(nested.message)
      }
    }
  } catch {
    // Fall through to the raw prefix.
  }
  if (options.includeDetail === true) {
    detail = detail === undefined || detail.length === 0 ? text : detail
  } else {
    detail = undefined
  }
  return {
    ...(code === undefined ? {} : { code: sanitizeDetail(code) }),
    detail: detail === undefined ? '' : sanitizeDetail(detail),
  }
}

/** Failure classes a provider HTTP status maps to. */
export type TinfoilHttpFailure =
  | 'auth'
  | 'billing'
  | 'not-found'
  | 'too-large'
  | 'quota'
  | 'rate-limit'
  | 'request-rejected'
  | 'unavailable'
  | 'failed'

/** Classify a provider HTTP status and optional provider error code. */
export function classifyHttpStatus(status: number, code?: string): TinfoilHttpFailure {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'billing'
  if (status === 404) return 'not-found'
  if (status === 413) return 'too-large'
  if (status === 429) {
    return code !== undefined && /quota|insufficient_quota/iu.test(code) ? 'quota' : 'rate-limit'
  }
  if (status === 400 || status === 422) return 'request-rejected'
  if (status >= 500) return 'unavailable'
  return 'failed'
}

/** Create a standard response-too-large error for one plugin. */
export function responseTooLarge(
  error: TinfoilErrorFactory,
  message: string,
): TinfoilError {
  return error(message, 'TINFOIL_RESPONSE_TOO_LARGE')
}
