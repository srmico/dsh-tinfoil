import { Buffer } from 'node:buffer'
import { TinfoilDocumentsError } from './errors.js'

export interface ConvertedPage {
  page: number
  text: string
  isScanned: boolean
  image?: Uint8Array
}

export interface ConvertedDocument {
  pageCount: number
  pages: ConvertedPage[]
  processingTimeMs?: number
}

export interface ConversionLimits {
  readonly maxPages?: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const DATA_URI = /^data:image\/png;base64,(.*)$/isu
const UNSAFE_DETAIL = /[\u0000-\u001f\u007f]+/gu

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function detail(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_DETAIL, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300)
}

function decodePageImage(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const match = DATA_URI.exec(value)
  const base64 = (match?.[1] ?? value).replace(/\s+/gu, '')
  if (base64.length === 0) return undefined
  const data = Buffer.from(base64, 'base64')
  if (data.length < PNG_SIGNATURE.length) return undefined
  for (const [index, byte] of PNG_SIGNATURE.entries()) {
    if (data[index] !== byte) return undefined
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function parsePages(rawPages: readonly unknown[], limits: ConversionLimits): ConvertedPage[] {
  if (limits.maxPages !== undefined && rawPages.length > limits.maxPages) {
    throw new TinfoilDocumentsError(
      `Tinfoil returned ${rawPages.length} pages, which exceeds maxPages (${limits.maxPages}). Raise maxPages or convert a smaller document.`,
      'DOCUMENT_TOO_MANY_PAGES',
    )
  }
  const parsed: ConvertedPage[] = []
  for (const [index, raw] of rawPages.entries()) {
    if (!isRecord(raw)) {
      throw new TinfoilDocumentsError('Tinfoil document conversion returned a malformed page.', 'TINFOIL_CONVERSION_FAILED')
    }
    const rawNumber = raw.page
    const pageNumber = typeof rawNumber === 'number' && Number.isInteger(rawNumber) && rawNumber > 0
      ? rawNumber
      : index + 1
    const text = typeof raw.text === 'string' ? raw.text : ''
    const image = decodePageImage(raw.image)
    parsed.push({
      page: pageNumber,
      text,
      isScanned: raw.is_scanned === true,
      ...(image === undefined ? {} : { image }),
    })
  }
  parsed.sort((left, right) => left.page - right.page)
  return parsed.map((page, index) => ({ ...page, page: index + 1 }))
}

export function parseConversionPayload(value: unknown, limits: ConversionLimits = {}): ConvertedDocument {
  if (!isRecord(value)) {
    throw new TinfoilDocumentsError('Tinfoil document conversion returned an unexpected response.', 'TINFOIL_CONVERSION_FAILED')
  }
  if (typeof value.status === 'string' && value.status !== 'success') {
    const reason = detail(value.error)
    throw new TinfoilDocumentsError(
      `Tinfoil document conversion failed${reason.length > 0 ? `: ${reason}` : '.'}`,
      'TINFOIL_CONVERSION_FAILED',
    )
  }

  let document: Record<string, unknown> | undefined
  if (isRecord(value.document)) {
    document = value.document
  } else if (Array.isArray(value.documents) && value.documents.length === 1 && isRecord(value.documents[0])) {
    document = value.documents[0]
  }
  if (document === undefined) {
    throw new TinfoilDocumentsError('Tinfoil document conversion returned no document.', 'TINFOIL_CONVERSION_FAILED')
  }

  const rawPages = document.pages
  const pages = Array.isArray(rawPages) && rawPages.length > 0
    ? parsePages(rawPages, limits)
    : [{
        page: 1,
        text: typeof document.md_content === 'string' ? document.md_content : '',
        isScanned: false,
      }]

  const processingTimeMs = typeof value.processing_time === 'number' && Number.isFinite(value.processing_time)
    ? Math.max(0, Math.round(value.processing_time * 1000))
    : undefined

  return {
    pageCount: pages.length,
    pages,
    ...(processingTimeMs === undefined ? {} : { processingTimeMs }),
  }
}
