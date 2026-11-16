import { basename } from 'node:path'

export const DOCUMENT_MEDIA_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
} as const

export type DocumentExtension = keyof typeof DOCUMENT_MEDIA_TYPES

const DOCUMENT_EXTENSIONS = new Set<string>(Object.keys(DOCUMENT_MEDIA_TYPES))
const UNSAFE_FILENAME = /[\u0000-\u001f\u007f"\\/:*?<>|]+/gu

export function documentExtension(filePath: string): DocumentExtension | undefined {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return undefined
  const extension = filePath.slice(dot).toLowerCase()
  return DOCUMENT_EXTENSIONS.has(extension) ? extension as DocumentExtension : undefined
}

export function documentMediaType(extension: DocumentExtension): string {
  return DOCUMENT_MEDIA_TYPES[extension]
}

export function isSupportedDocumentPath(filePath: string): boolean {
  return documentExtension(filePath) !== undefined
}

function readFilePath(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const value = (args as { file_path?: unknown }).file_path
  return typeof value === 'string' ? value : undefined
}

export function readRedirectReason(toolName: string, args: unknown): string | undefined {
  if (toolName !== 'read') return undefined
  const filePath = readFilePath(args)
  if (filePath === undefined) return undefined
  const extension = documentExtension(filePath)
  if (extension === undefined) return undefined
  return `${JSON.stringify(filePath)} is a ${extension} document. Use read_document instead: it returns page-level Markdown and supports page ranges, for example read_document({ file_path: ${JSON.stringify(filePath)} }).`
}

export function sanitizeMultipartFilename(filePath: string, extension: DocumentExtension): string {
  const cleaned = basename(filePath).replace(UNSAFE_FILENAME, '_').trim()
  const bounded = cleaned.slice(0, 180)
  if (bounded.length === 0) return `document${extension}`
  return bounded.toLowerCase().endsWith(extension) ? bounded : `${bounded}${extension}`
}
