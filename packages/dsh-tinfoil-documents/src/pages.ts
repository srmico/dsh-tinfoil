import { TinfoilDocumentsError } from './errors.js'

export interface DocumentPage {
  page: number
  text: string
  isScanned: boolean
}

export interface PageRange {
  start: number
  end: number
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TinfoilDocumentsError(`${name} must be a positive integer.`, 'PAGE_OUT_OF_RANGE')
  }
  return value
}

export function resolvePageRange(
  pageCount: number,
  pageStart: number | undefined,
  pageEnd: number | undefined,
  defaultWindow: number,
): PageRange {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new TinfoilDocumentsError('The converted document has no readable pages.', 'TINFOIL_CONVERSION_FAILED')
  }
  const start = pageStart === undefined ? 1 : positiveInteger(pageStart, 'page_start')
  if (start > pageCount) {
    throw new TinfoilDocumentsError(`page_start ${start} is outside 1-${pageCount}.`, 'PAGE_OUT_OF_RANGE')
  }
  const end = pageEnd === undefined
    ? Math.min(pageCount, start + Math.max(1, defaultWindow) - 1)
    : positiveInteger(pageEnd, 'page_end')
  if (end > pageCount) {
    throw new TinfoilDocumentsError(`page_end ${end} is outside 1-${pageCount}.`, 'PAGE_OUT_OF_RANGE')
  }
  if (start > end) {
    throw new TinfoilDocumentsError(`page_start ${start} is after page_end ${end}.`, 'PAGE_OUT_OF_RANGE')
  }
  return { start, end }
}

export function scannedPageNumbers(pages: readonly Pick<DocumentPage, 'page' | 'isScanned'>[]): number[] {
  return pages.filter(page => page.isScanned).map(page => page.page)
}

export interface FormatDocumentOptions {
  path: string
  pageCount: number
  pages: readonly DocumentPage[]
  pageStart: number
  pageEnd: number
  charOffset: number
  maxChars: number
  pageImagesAvailable: boolean
}

export interface FormattedDocument {
  markdown: string
  charOffset: number
  totalChars: number
  truncated: boolean
}

function pageBody(page: DocumentPage, pageImagesAvailable: boolean): string {
  const heading = `===== Page ${page.page} =====`
  if (page.text.trim().length > 0) return `${heading}\n${page.text}`
  if (page.isScanned) {
    return pageImagesAvailable
      ? `${heading}\n_No text extracted; this page is scanned. Use read_document_as_image to view it._`
      : `${heading}\n_No text extracted; this page is scanned. OCR is not supported yet._`
  }
  return `${heading}\n_No text on this page._`
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export function formatDocumentOutput(options: FormatDocumentOptions): FormattedDocument {
  if (!Number.isInteger(options.charOffset) || options.charOffset < 0) {
    throw new TinfoilDocumentsError('char_offset must be a non-negative integer.', 'CHAR_OFFSET_OUT_OF_RANGE')
  }
  const body = options.pages
    .map(page => pageBody(page, options.pageImagesAvailable))
    .join('\n\n')
  const totalChars = body.length
  let start = options.charOffset
  if (totalChars > 0 && start >= totalChars) {
    throw new TinfoilDocumentsError(
      `char_offset ${start} is outside the selected text, which has ${totalChars} characters.`,
      'CHAR_OFFSET_OUT_OF_RANGE',
    )
  }
  if (start > 0 && isLowSurrogate(body.charCodeAt(start))) {
    start -= 1
  }
  let end = Math.min(totalChars, start + Math.max(1, options.maxChars))
  if (end < totalChars && end > start + 1 && isHighSurrogate(body.charCodeAt(end - 1))) {
    end -= 1
  }
  const truncated = end < totalChars
  const header = [`Document: ${options.path}`, `Pages: ${options.pageStart}-${options.pageEnd} of ${options.pageCount}`]
  if (start > 0) header.push(`Continuing at character ${start} of ${totalChars}`)
  const marker = truncated
    ? `\n\n[Output truncated at character ${end} of ${totalChars} for pages ${options.pageStart}-${options.pageEnd}. Continue with read_document({ file_path: ${JSON.stringify(options.path)}, page_start: ${options.pageStart}, page_end: ${options.pageEnd}, char_offset: ${end} }).]`
    : ''
  return {
    markdown: `${header.join('\n')}\n\n${body.slice(start, end)}${marker}`,
    charOffset: start,
    totalChars,
    truncated,
  }
}

export interface ImageHeaderPage {
  page: number
  isScanned: boolean
}

export function formatImageHeader(path: string, pageCount: number, pages: readonly ImageHeaderPage[]): string {
  const first = pages[0]?.page ?? 1
  const last = pages.at(-1)?.page ?? first
  const lines = [`Document: ${path}`, `Pages: ${first}-${last} of ${pageCount}`]
  for (const page of pages) lines.push(`Page ${page.page}${page.isScanned ? ' (scanned)' : ''}`)
  return lines.join('\n')
}
