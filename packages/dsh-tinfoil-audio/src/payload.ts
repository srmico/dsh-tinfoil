import { TinfoilAudioError } from './errors.js'
import type { TranscriptFormat } from './config.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(cause?: unknown): TinfoilAudioError {
  return new TinfoilAudioError(
    'Tinfoil audio returned an unexpected response.',
    'TINFOIL_RESPONSE_INVALID',
    cause === undefined ? undefined : { cause },
  )
}

export function parseTranscriptionBody(body: string, format: TranscriptFormat): string {
  if (format === 'text') return body
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch (error) {
    throw invalidResponse(error)
  }
  if (!isRecord(value) || typeof value.text !== 'string') throw invalidResponse()
  return value.text
}

export function assertSpeechInput(text: string, maxChars: number): void {
  if (text.trim().length === 0) {
    throw new TinfoilAudioError('The text to synthesize must not be empty.', 'INPUT_EMPTY')
  }
  if (text.length > maxChars) {
    throw new TinfoilAudioError(
      `Text is ${text.length} characters, which exceeds maxSpeechChars (${maxChars}). The hosted qwen3-tts talker has a 4096-token context shared by the input text and generated audio, so a single request cannot synthesize arbitrarily long input. Split the text at sentence or paragraph boundaries.`,
      'INPUT_TOO_LARGE',
    )
  }
}
