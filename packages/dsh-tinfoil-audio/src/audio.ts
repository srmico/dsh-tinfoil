import { Buffer } from 'node:buffer'
import { basename } from 'node:path'

export const AUDIO_MEDIA_TYPES = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.mpeg': 'audio/mpeg',
  '.mpga': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
} as const

export type AudioExtension = keyof typeof AUDIO_MEDIA_TYPES

export const SUPPORTED_AUDIO_EXTENSIONS = Object.keys(AUDIO_MEDIA_TYPES) as readonly AudioExtension[]

const AUDIO_EXTENSION_SET = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS)
const UNSAFE_FILENAME = /[\u0000-\u001f\u007f"\\/:*?<>|]+/gu
const SUBTYPE = /[^a-z0-9]+/gu

function ascii(data: Uint8Array, start: number, length: number): string {
  return Buffer.from(data.subarray(start, start + length)).toString('latin1')
}

function isRiffWave(data: Uint8Array): boolean {
  return data.byteLength >= 12 && ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WAVE'
}

function isMpeg(data: Uint8Array): boolean {
  if (data.byteLength >= 3 && ascii(data, 0, 3) === 'ID3') return true
  const first = data[0]
  const second = data[1]
  return first !== undefined && second !== undefined && first === 0xff && (second & 0xe0) === 0xe0
}

function isFlac(data: Uint8Array): boolean {
  return data.byteLength >= 4 && ascii(data, 0, 4) === 'fLaC'
}

function isOgg(data: Uint8Array): boolean {
  return data.byteLength >= 4 && ascii(data, 0, 4) === 'OggS'
}

function isWebm(data: Uint8Array): boolean {
  if (data.byteLength < 4) return false
  return data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3
}

function requiresMagic(contentType: string): boolean {
  return contentType === 'audio/wav'
    || contentType === 'audio/x-wav'
    || contentType === 'audio/mpeg'
    || contentType === 'audio/mp3'
    || contentType === 'audio/flac'
    || contentType === 'audio/ogg'
    || contentType === 'audio/webm'
    || contentType === 'audio/opus'
}

export function audioExtension(filePath: string): AudioExtension | undefined {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return undefined
  const extension = filePath.slice(dot).toLowerCase()
  return AUDIO_EXTENSION_SET.has(extension) ? extension as AudioExtension : undefined
}

export function audioMediaType(extension: AudioExtension): string {
  return AUDIO_MEDIA_TYPES[extension]
}

export function sanitizeAudioFilename(filePath: string, extension: AudioExtension): string {
  const cleaned = basename(filePath).replace(UNSAFE_FILENAME, '_').trim()
  const bounded = cleaned.slice(0, 180)
  if (bounded.length === 0) return `audio${extension}`
  return bounded.toLowerCase().endsWith(extension) ? bounded : `${bounded}${extension}`
}

export function sanitizeLeafName(value: string): string {
  const cleaned = basename(value).replace(UNSAFE_FILENAME, '_').trim()
  const bounded = cleaned.slice(0, 180)
  return bounded.length === 0 || bounded === '.' || bounded === '..' ? 'speech' : bounded
}

export function speechFileName(value: string | undefined, extension: string): string {
  const sanitized = sanitizeLeafName(value ?? 'speech')
  const dot = sanitized.lastIndexOf('.')
  const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized
  const base = stem.length === 0 ? 'speech' : stem
  return `${base}.${extension}`
}

export function parseContentType(value: string | null): string | undefined {
  if (value === null) return undefined
  const type = value.split(';', 1)[0]?.trim().toLowerCase()
  return type === undefined || type.length === 0 ? undefined : type
}

export function sniffAudioMediaType(prefix: Uint8Array, contentType: string | undefined): string | undefined {
  const type = parseContentType(contentType ?? null)
  if (isRiffWave(prefix)) return 'audio/wav'
  if (isMpeg(prefix)) return 'audio/mpeg'
  if (isFlac(prefix)) return 'audio/flac'
  if (isOgg(prefix)) return type === 'audio/opus' ? 'audio/opus' : 'audio/ogg'
  if (isWebm(prefix)) return 'audio/webm'
  if (type === 'audio/pcm') return type
  if (type !== undefined && type.startsWith('audio/') && !requiresMagic(type)) return type
  return undefined
}

export function audioExtensionForMediaType(mediaType: string): string {
  const type = parseContentType(mediaType) ?? 'audio/wav'
  switch (type) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/flac':
      return 'flac'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/opus':
      return 'opus'
    case 'audio/webm':
      return 'webm'
    case 'audio/pcm':
      return 'pcm'
    default: {
      const subtype = type.split('/')[1]?.toLowerCase().replace(SUBTYPE, '')
      return subtype === undefined || subtype.length === 0 ? 'wav' : subtype
    }
  }
}

export function wavDurationSeconds(data: Uint8Array): number | undefined {
  if (data.byteLength < 12 || !isRiffWave(data)) return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 12
  let byteRate = 0
  let dataSize = 0
  while (offset + 8 <= data.byteLength) {
    const id = ascii(data, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (id === 'fmt ' && size >= 16 && start + 16 <= data.byteLength) {
      const channels = view.getUint16(start + 2, true)
      const sampleRate = view.getUint32(start + 4, true)
      byteRate = view.getUint32(start + 8, true)
      if (channels === 0 || sampleRate === 0 || byteRate === 0) return undefined
    }
    if (id === 'data') {
      dataSize = size
      break
    }
    const next = start + size + (size % 2)
    if (next <= offset) return undefined
    offset = next
  }
  if (byteRate <= 0 || dataSize <= 0 || dataSize === 0xffffffff) return undefined
  return dataSize / byteRate
}
