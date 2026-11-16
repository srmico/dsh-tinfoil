import { Buffer } from 'node:buffer'
import { TextDecoder } from 'node:util'
import { TinfoilPiiError } from './errors.js'

export interface RedactionResult {
  redactedText: string
  spanCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(cause?: unknown): TinfoilPiiError {
  return new TinfoilPiiError(
    'Tinfoil privacy filter returned an unexpected response.',
    'TINFOIL_RESPONSE_INVALID',
    cause === undefined ? undefined : { cause },
  )
}

function stripSensitive(key: string, value: unknown): unknown {
  return key === 'text' || key === 'summary' ? undefined : value
}

export function parseRedactionBody(body: string): RedactionResult {
  let value: unknown
  try {
    value = JSON.parse(body, stripSensitive)
  } catch (error) {
    throw invalidResponse(error)
  }
  return parseRedactionPayload(value)
}

export function parseRedactionPayload(value: unknown): RedactionResult {
  if (!isRecord(value)) throw invalidResponse()
  const redactedText = value.redacted_text
  if (typeof redactedText !== 'string') throw invalidResponse()
  const spans = value.detected_spans
  if (!Array.isArray(spans)) throw invalidResponse()
  return { redactedText, spanCount: spans.length }
}

export function assertTextInputSize(text: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) {
    throw new TinfoilPiiError(
      `Text is ${bytes} bytes, which exceeds maxTextInputBytes (${maxBytes}). Use redact_file for large text, or split it at line or paragraph boundaries. Redaction is not applied across chunks, so an entity split between chunks can be missed.`,
      'INPUT_TOO_LARGE',
    )
  }
}

export function decodeUtf8Text(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new TinfoilPiiError(
      'The file is not valid UTF-8 text.',
      'FILE_NOT_TEXT',
      { cause: error },
    )
  }
}
