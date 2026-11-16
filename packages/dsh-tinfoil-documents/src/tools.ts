import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { CacheEntryMeta, CacheSource, CachedPage, ConversionCache } from './cache.js'
import { cacheKey } from './cache.js'
import type { ResolvedConfig } from './config.js'
import { documentExtension, documentMediaType, sanitizeMultipartFilename } from './documents.js'
import type { DocumentExtension } from './documents.js'
import { TinfoilDocumentsError } from './errors.js'
import { formatDocumentOutput, formatImageHeader, resolvePageRange, scannedPageNumbers } from './pages.js'
import type { DocumentPage, PageRange } from './pages.js'
import type { ConvertedDocument } from './payload.js'
import type { TinfoilConverter } from './tinfoil-client.js'

const MAX_PAGE_IMAGES = 10
const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

interface ImageValue {
  attachmentId: string
  mediaType: 'image/png'
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: {
    width: number
    height: number
  }
}

interface ImagePageValue {
  page: number
  isScanned: boolean
  image: ImageValue
}

export interface DocumentToolDependencies {
  config: ResolvedConfig
  cache: ConversionCache
  converter: TinfoilConverter
  imageToolAvailable: boolean
}

interface LoadedDocument {
  target: FsTarget
  info: FsInfo
  data: Uint8Array
  key: string
  extension: DocumentExtension
  source: CacheSource
  entry: CacheEntryMeta
  signal: AbortSignal
  convert: (signal: AbortSignal) => Promise<ConvertedDocument>
}

interface SelectedImage {
  page: number
  isScanned: boolean
  data: Uint8Array
}

function isCacheCorrupted(error: unknown): boolean {
  return error instanceof TinfoilDocumentsError && error.code === 'CACHE_CORRUPTED'
}

function imageValue(ref: ImageAttachmentRef): ImageValue {
  if (ref.mediaType !== 'image/png') {
    throw new Error(`the attachment service returned ${ref.mediaType} instead of a PNG page image`)
  }
  return {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
    ...(ref.originalDimensions === undefined ? {} : { originalDimensions: { ...ref.originalDimensions } }),
  }
}

function imageRefFromValue(image: ImageValue): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
    ...(image.originalDimensions === undefined ? {} : { originalDimensions: { ...image.originalDimensions } }),
  }
}

function scannedError(pages: readonly number[], imageToolAvailable: boolean): TinfoilDocumentsError {
  const label = pages.length === 1 ? `Scanned page ${pages[0]}` : `Scanned pages ${pages.join(', ')}`
  const verb = pages.length === 1 ? 'is' : 'are'
  const hint = imageToolAvailable ? ' Use read_document_as_image to view them.' : ''
  return new TinfoilDocumentsError(
    `${label} ${verb} not supported yet; OCR extraction is planned as read_document_with_ocr.${hint}`,
    'SCANNED_PAGES_UNSUPPORTED',
  )
}

function selectPages(entry: CacheEntryMeta, range: PageRange): CachedPage[] {
  return entry.pages.filter(page => page.page >= range.start && page.page <= range.end)
}

async function loadDocument(
  ctx: Context,
  exec: ToolExecution,
  deps: DocumentToolDependencies,
  filePath: string,
): Promise<LoadedDocument> {
  const extension = documentExtension(filePath)
  if (extension === undefined) {
    throw new TinfoilDocumentsError(
      `"${filePath}" is not a supported document. Supported extensions: .pdf, .docx, .pptx, .xlsx, .html, .htm, .csv.`,
      'UNSUPPORTED_DOCUMENT',
    )
  }
  deps.converter.assertApiKey()
  const agent = exec.agent
  const cwd = agent === undefined
    ? undefined
    : await ctx.workingDirectory.ensure(agent, exec.signal)
  const target = await ctx.fs.resolve(filePath, {
    ...(cwd === undefined ? {} : { cwd }),
    signal: exec.signal,
  })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  if (info.size !== undefined && info.size > deps.config.maxInputBytes) {
    throw new TinfoilDocumentsError(
      `"${target.displayPath}" is ${info.size} bytes, which exceeds maxInputBytes (${deps.config.maxInputBytes}).`,
      'DOCUMENT_TOO_LARGE',
    )
  }
  let data: Uint8Array
  try {
    data = await ctx.fs.readBytes(target, exec.signal, deps.config.maxInputBytes)
  } catch (error) {
    if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
      throw new TinfoilDocumentsError(
        `"${target.displayPath}" exceeds maxInputBytes (${deps.config.maxInputBytes}).`,
        'DOCUMENT_TOO_LARGE',
        { cause: error },
      )
    }
    throw error
  }
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  const source: CacheSource = {
    name: sanitizeMultipartFilename(filePath, extension),
    extension,
    mediaType: documentMediaType(extension),
    bytes: data.byteLength,
  }
  const key = cacheKey(data, source, deps.config.cacheIdentity)
  const convert = (signal: AbortSignal): Promise<ConvertedDocument> => deps.converter.convert({
    data,
    filename: source.name,
    mediaType: source.mediaType,
    signal,
  })
  const isVerified = (): boolean => deps.converter.verification()?.securityVerified === true
  let entry: CacheEntryMeta
  try {
    entry = await deps.cache.getOrConvert(key, source, convert, isVerified, exec.signal)
  } catch (error) {
    if (!isCacheCorrupted(error)) throw error
    await deps.cache.invalidate(key)
    entry = await deps.cache.getOrConvert(key, source, convert, isVerified, exec.signal)
  }
  return { target, info, data, key, extension, source, entry, signal: exec.signal, convert }
}

async function readPageTexts(
  deps: DocumentToolDependencies,
  loaded: LoadedDocument,
  range: PageRange,
): Promise<{ entry: CacheEntryMeta; pages: DocumentPage[] }> {
  const read = async (entry: CacheEntryMeta): Promise<DocumentPage[]> => {
    const selected = selectPages(entry, range)
    const scanned = scannedPageNumbers(selected)
    if (scanned.length > 0) throw scannedError(scanned, deps.imageToolAvailable)
    return Promise.all(selected.map(async page => ({
      page: page.page,
      text: await deps.cache.readText(entry, page.page),
      isScanned: page.isScanned,
    })))
  }
  try {
    return { entry: loaded.entry, pages: await read(loaded.entry) }
  } catch (error) {
    if (!isCacheCorrupted(error)) throw error
    await deps.cache.invalidate(loaded.key)
    const entry = await deps.cache.getOrConvert(
      loaded.key,
      loaded.source,
      loaded.convert,
      () => deps.converter.verification()?.securityVerified === true,
      loaded.signal,
    )
    return { entry, pages: await read(entry) }
  }
}

async function readPageImages(
  deps: DocumentToolDependencies,
  loaded: LoadedDocument,
  range: PageRange,
): Promise<{ entry: CacheEntryMeta; images: SelectedImage[] }> {
  const read = async (entry: CacheEntryMeta): Promise<SelectedImage[]> => {
    const selected = selectPages(entry, range)
    const missing = selected.filter(page => page.imageFile === undefined).map(page => page.page)
    if (missing.length > 0) {
      throw new TinfoilDocumentsError(
        `No page image is available for ${missing.length === 1 ? `page ${missing[0]}` : `pages ${missing.join(', ')}`}. This format may not return page images; use read_document for text.`,
        'PAGE_IMAGES_UNAVAILABLE',
      )
    }
    return Promise.all(selected.map(async page => {
      const data = await deps.cache.readImage(entry, page.page)
      if (data === undefined) {
        throw new TinfoilDocumentsError(
          `No page image is available for page ${page.page}.`,
          'PAGE_IMAGES_UNAVAILABLE',
        )
      }
      return { page: page.page, isScanned: page.isScanned, data }
    }))
  }
  try {
    return { entry: loaded.entry, images: await read(loaded.entry) }
  } catch (error) {
    if (!isCacheCorrupted(error)) throw error
    await deps.cache.invalidate(loaded.key)
    const entry = await deps.cache.getOrConvert(
      loaded.key,
      loaded.source,
      loaded.convert,
      () => deps.converter.verification()?.securityVerified === true,
      loaded.signal,
    )
    return { entry, images: await read(entry) }
  }
}

async function assertImageRoute(ctx: Context, exec: ToolExecution, filePath: string): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read "${filePath}" as images: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(
      `cannot read "${filePath}" as images: model "${model}" does not declare image input; switch to an image-capable model or use read_document for text`,
    )
  }
}

export function registerReadDocument(ctx: Context, deps: DocumentToolDependencies): void {
  const imageNote = deps.imageToolAvailable
    ? ' Use read_document_as_image to view a scanned page or a figure.'
    : ''
  ctx.tools.register(defineTool({
    name: 'read_document',
    description: `Read a PDF, DOCX, PPTX, XLSX, HTML, or CSV document and return extracted Markdown, one page range at a time. Tinfoil converts the whole document once and caches it. Defaults to the first ${deps.config.defaultPageWindow} pages; use page_end or char_offset for more. Scanned pages are not supported yet.${imageNote}`,
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the document, resolved by the filesystem backend.' },
      page_start: { type: 'integer', description: '1-based first page. Defaults to 1.' },
      page_end: { type: 'integer', description: '1-based last page, inclusive. Defaults to a bounded window from page_start.' },
      char_offset: { type: 'integer', description: '0-based character offset into the selected pages for continuing a long response. Defaults to 0.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          pageStart: { type: 'integer', required: true },
          pageEnd: { type: 'integer', required: true },
          pageCount: { type: 'integer', required: true },
          charOffset: { type: 'integer', required: true },
          totalChars: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          markdown: { type: 'string', required: true },
        },
      },
      render: (_args, value): ContentBlock[] => [{ type: 'text', text: value.markdown }],
      presentationMeta: (_args, value) => ({
        path: value.path,
        pageStart: value.pageStart,
        pageEnd: value.pageEnd,
        pageCount: value.pageCount,
      }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const loaded = await loadDocument(ctx, exec, deps, args.file_path)
      const range = resolvePageRange(
        loaded.entry.pageCount,
        args.page_start,
        args.page_end,
        deps.config.defaultPageWindow,
      )
      const { entry, pages } = await readPageTexts(deps, loaded, range)
      const path = ctx.fs.processPath(loaded.target)
      const formatted = formatDocumentOutput({
        path,
        pageCount: entry.pageCount,
        pages,
        pageStart: range.start,
        pageEnd: range.end,
        charOffset: args.char_offset ?? 0,
        maxChars: deps.config.maxOutputChars,
        pageImagesAvailable: deps.imageToolAvailable,
      })
      return {
        path,
        pageStart: range.start,
        pageEnd: range.end,
        pageCount: entry.pageCount,
        charOffset: formatted.charOffset,
        totalChars: formatted.totalChars,
        truncated: formatted.truncated,
        markdown: formatted.markdown,
      }
    },
    presentCall(args): GenericCallView {
      const range = args.page_start === undefined && args.page_end === undefined
        ? ''
        : ` (pages ${args.page_start ?? 1}-${args.page_end ?? 'end'})`
      const offset = args.char_offset === undefined || args.char_offset === 0 ? '' : ` from character ${args.char_offset}`
      return {
        card: 'generic',
        title: `Read document ${args.file_path}${range}${offset}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}

export function registerReadDocumentAsImage(ctx: Context, deps: DocumentToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'read_document_as_image',
    description: 'Render one or more pages of a PDF, DOCX, PPTX, XLSX, HTML, or CSV document as PNG images. Defaults to one page; page ranges are capped at 10 images. Tinfoil converts and caches the whole document first. Requires a model route that accepts image input.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the document, resolved by the filesystem backend.' },
      page_start: { type: 'integer', description: '1-based first page. Defaults to 1.' },
      page_end: { type: 'integer', description: '1-based last page, inclusive. Defaults to page_start.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          pageStart: { type: 'integer', required: true },
          pageEnd: { type: 'integer', required: true },
          pageCount: { type: 'integer', required: true },
          images: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                page: { type: 'integer', required: true },
                isScanned: { type: 'boolean', required: true },
                image: IMAGE_VALUE_SCHEMA,
              },
            },
          },
        },
      },
      render: (_args, value): ContentBlock[] => [
        { type: 'text', text: formatImageHeader(value.path, value.pageCount, value.images) },
        ...value.images.map(item => ({ type: 'image' as const, attachment: imageRefFromValue(item.image) })),
      ],
      presentationMeta: (_args, value) => ({
        path: value.path,
        pageStart: value.pageStart,
        pageEnd: value.pageEnd,
        pageCount: value.pageCount,
      }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      await assertImageRoute(ctx, exec, args.file_path)
      const loaded = await loadDocument(ctx, exec, deps, args.file_path)
      const start = args.page_start ?? 1
      const requestedEnd = args.page_end ?? start
      const range = resolvePageRange(loaded.entry.pageCount, start, requestedEnd, 1)
      if (range.end - range.start + 1 > MAX_PAGE_IMAGES) {
        throw new TinfoilDocumentsError(
          `Request at most ${MAX_PAGE_IMAGES} page images per call; pages ${range.start}-${range.end} span ${range.end - range.start + 1}.`,
          'PAGE_RANGE_TOO_LARGE',
        )
      }
      const { entry, images } = await readPageImages(deps, loaded, range)
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('cannot read document pages as images: no attachment service is mounted')
      }
      const refs = await attachments.saveImages(images.map(image => ({
        data: image.data,
        mediaType: 'image/png' as const,
        name: `page-${String(image.page).padStart(3, '0')}.png`,
      })))
      const path = ctx.fs.processPath(loaded.target)
      const values: ImagePageValue[] = refs.map((ref, index) => {
        const source = images[index]
        if (source === undefined) {
          throw new Error('the attachment service returned more images than were requested')
        }
        return { page: source.page, isScanned: source.isScanned, image: imageValue(ref) }
      })
      return {
        path,
        pageStart: range.start,
        pageEnd: range.end,
        pageCount: entry.pageCount,
        images: values,
      }
    },
    presentCall(args): GenericCallView {
      const range = args.page_start === undefined && args.page_end === undefined
        ? ''
        : ` (pages ${args.page_start ?? 1}-${args.page_end ?? args.page_start ?? 1})`
      return {
        card: 'generic',
        title: `Read document as images ${args.file_path}${range}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
