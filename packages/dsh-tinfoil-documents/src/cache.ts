import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { LRUCache } from 'lru-cache'
import { raceWithSignal } from '@srmico/dsh-tinfoil-lib'
import { TinfoilDocumentsError } from './errors.js'
import type { ConvertedDocument } from './payload.js'

const MANIFEST_VERSION = 2
const INDEX_VERSION = 2
const PAGE_DIR = 'pages'
const MANIFEST_FILE = 'manifest.json'
const INDEX_FILE = 'index.json'
const TMP_PREFIX = '.tmp-'
const INDEX_TMP_PREFIX = 'index.json.tmp-'
const TMP_MAX_AGE_MS = 60 * 60 * 1000
const INDEX_FLUSH_MS = 250
const MANIFEST_OVERHEAD = 1024
const HEX64 = /^[0-9a-f]{64}$/u
const UNSAFE_DETAIL = /[\u0000-\u001f\u007f]+/gu

export interface CachedPage {
  page: number
  textFile: string
  textBytes: number
  imageFile?: string
  imageBytes?: number
  isScanned: boolean
}

export interface CacheManifest {
  version: 2
  cacheKey: string
  converterIdentity: string
  securityVerified: boolean
  sourceName: string
  sourceExtension: string
  sourceMediaType: string
  sourceBytes: number
  pageCount: number
  pages: CachedPage[]
  totalBytes: number
  processingTimeMs?: number
  createdAt: string
  lastAccessed: string
}

export interface CacheEntryMeta {
  key: string
  size: number
  pageCount: number
  lastAccessed: number
  pages: CachedPage[]
  securityVerified: boolean
}

export interface CacheSource {
  name: string
  extension: string
  mediaType: string
  bytes: number
}

export interface ConversionCacheOptions {
  root: string
  identity: string
  requireVerification: boolean
  maxBytes: number
  ttlMs: number
}

interface InFlightConversion {
  readonly promise: Promise<CacheEntryMeta>
  readonly controller: AbortController
  waiters: number
}

interface IndexEntry {
  size: number
  lastAccessed: number
  pageCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isSafeRelative(value: string, prefix: string): boolean {
  if (value.startsWith('/') || value.startsWith('\\') || value.includes('\\') || value.includes('\u0000')) return false
  const parts = value.split('/')
  if (parts[0] !== prefix) return false
  return parts.every(part => part.length > 0 && part !== '.' && part !== '..')
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  return error.message.replace(UNSAFE_DETAIL, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300)
}

function syncPath(path: string): Promise<void> {
  return open(path, 'r')
    .then(async handle => {
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    })
    .catch(() => {})
}

function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  return syncPath(path)
}

export function cacheKey(data: Uint8Array, source: CacheSource, identity: string): string {
  return createHash('sha256')
    .update(identity)
    .update('\u0000')
    .update(source.extension)
    .update('\u0000')
    .update(source.mediaType)
    .update('\u0000')
    .update(data)
    .digest('hex')
}

export class ConversionCache {
  private readonly root: string
  private readonly identity: string
  private readonly requireVerification: boolean
  private readonly maxBytes: number
  private readonly ttlMs: number
  private readonly lru: LRUCache<string, CacheEntryMeta>
  private readonly inFlight = new Map<string, InFlightConversion>()
  private ready = false
  private disposed = false
  private initializing: Promise<void> | undefined
  private flushTimer: NodeJS.Timeout | undefined

  constructor(options: ConversionCacheOptions) {
    this.root = options.root
    this.identity = options.identity
    this.requireVerification = options.requireVerification
    this.maxBytes = options.maxBytes
    this.ttlMs = options.ttlMs
    this.lru = new LRUCache<string, CacheEntryMeta>({
      maxSize: options.maxBytes,
      sizeCalculation: entry => Math.max(1, entry.size),
      ttl: options.ttlMs,
      updateAgeOnGet: true,
      dispose: (_entry, key, reason) => {
        if (reason === 'evict' || reason === 'expire') {
          void rm(join(this.root, key), { recursive: true, force: true }).catch(() => {})
        }
        this.scheduleFlush()
      },
    })
  }

  async initialize(): Promise<void> {
    if (this.ready) return
    this.initializing ??= this.reconcile().then(
      () => {
        this.ready = true
        this.initializing = undefined
      },
      error => {
        this.initializing = undefined
        throw error
      },
    )
    await this.initializing
  }

  async getOrConvert(
    key: string,
    source: CacheSource,
    convert: (signal: AbortSignal) => Promise<ConvertedDocument>,
    isVerified: () => boolean,
    signal: AbortSignal,
  ): Promise<CacheEntryMeta> {
    await this.initialize()
    const existing = this.lru.get(key)
    if (existing !== undefined) {
      existing.lastAccessed = Date.now()
      this.scheduleFlush()
      return existing
    }
    let flight = this.inFlight.get(key)
    if (flight === undefined) {
      const controller = new AbortController()
      const promise = this.buildEntry(key, source, convert, isVerified, controller.signal).finally(() => {
        if (this.inFlight.get(key)?.controller === controller) this.inFlight.delete(key)
      })
      promise.catch(() => {})
      flight = { promise, controller, waiters: 0 }
      this.inFlight.set(key, flight)
    }
    flight.waiters += 1
    try {
      return await raceWithSignal(flight.promise, signal)
    } finally {
      flight.waiters -= 1
      if (flight.waiters === 0 && signal.aborted) {
        flight.controller.abort(signal.reason)
        if (this.inFlight.get(key) === flight) this.inFlight.delete(key)
      }
    }
  }

  async readText(entry: CacheEntryMeta, page: number): Promise<string> {
    const meta = entry.pages.find(candidate => candidate.page === page)
    if (meta === undefined) {
      throw new TinfoilDocumentsError(`Page ${page} is not in the cached document.`, 'PAGE_OUT_OF_RANGE')
    }
    try {
      this.assertReadableEntry(entry)
      const path = this.entryPath(entry.key, meta.textFile)
      await this.assertRegularFile(path, meta.textBytes)
      const text = await readFile(path, 'utf8')
      entry.lastAccessed = Date.now()
      this.scheduleFlush()
      return text
    } catch (error) {
      if (error instanceof TinfoilDocumentsError) throw error
      throw new TinfoilDocumentsError(
        `Cached text for page ${page} is unreadable: ${errorText(error)}`,
        'CACHE_CORRUPTED',
        { cause: error },
      )
    }
  }

  async readImage(entry: CacheEntryMeta, page: number): Promise<Uint8Array | undefined> {
    const meta = entry.pages.find(candidate => candidate.page === page)
    if (meta === undefined) {
      throw new TinfoilDocumentsError(`Page ${page} is not in the cached document.`, 'PAGE_OUT_OF_RANGE')
    }
    if (meta.imageFile === undefined) return undefined
    try {
      this.assertReadableEntry(entry)
      const path = this.entryPath(entry.key, meta.imageFile)
      await this.assertRegularFile(path, meta.imageBytes)
      const data = await readFile(path)
      entry.lastAccessed = Date.now()
      this.scheduleFlush()
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    } catch (error) {
      if (error instanceof TinfoilDocumentsError) throw error
      throw new TinfoilDocumentsError(
        `Cached image for page ${page} is unreadable: ${errorText(error)}`,
        'CACHE_CORRUPTED',
        { cause: error },
      )
    }
  }

  async invalidate(key: string): Promise<void> {
    this.lru.delete(key)
    await rm(join(this.root, key), { recursive: true, force: true }).catch(() => {})
    this.scheduleFlush()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const flight of this.inFlight.values()) {
      flight.controller.abort(new Error('tinfoil documents cache disposed'))
    }
    this.inFlight.clear()
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    void this.flushIndex()
  }

  private async reconcile(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const index = await this.readIndex()
    const now = Date.now()
    const found: { key: string; meta: CacheEntryMeta }[] = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      const name = entry.name
      const path = join(this.root, name)
      if (entry.isDirectory()) {
        if (name.startsWith(TMP_PREFIX)) {
          const info = await stat(path).catch(() => undefined)
          if (info !== undefined && now - info.mtimeMs > TMP_MAX_AGE_MS) {
            await rm(path, { recursive: true, force: true }).catch(() => {})
          }
          continue
        }
        if (!HEX64.test(name)) continue
        const manifest = await this.readManifest(path, name)
        if (manifest === undefined) {
          await rm(path, { recursive: true, force: true }).catch(() => {})
          continue
        }
        const indexed = index.get(name)
        const lastAccessed = indexed ?? Date.parse(manifest.lastAccessed)
        const accessed = Number.isFinite(lastAccessed) ? lastAccessed : now
        if (now - accessed > this.ttlMs || manifest.totalBytes > this.maxBytes) {
          await rm(path, { recursive: true, force: true }).catch(() => {})
          continue
        }
        found.push({ key: name, meta: this.metaFromManifest(manifest, accessed) })
        continue
      }
      if (entry.isFile() && name.startsWith(INDEX_TMP_PREFIX)) {
        const info = await stat(path).catch(() => undefined)
        if (info !== undefined && now - info.mtimeMs > TMP_MAX_AGE_MS) {
          await rm(path, { force: true }).catch(() => {})
        }
      }
    }
    found.sort((left, right) => left.meta.lastAccessed - right.meta.lastAccessed)
    for (const { key, meta } of found) this.lru.set(key, meta)
    this.ready = true
    await this.flushIndex()
  }

  private async buildEntry(
    key: string,
    source: CacheSource,
    convert: (signal: AbortSignal) => Promise<ConvertedDocument>,
    isVerified: () => boolean,
    signal: AbortSignal,
  ): Promise<CacheEntryMeta> {
    const finalDir = join(this.root, key)
    const existing = await this.readManifest(finalDir, key)
    if (existing !== undefined) {
      return this.remember(existing, Date.parse(existing.lastAccessed) || Date.now())
    }
    const document = await convert(signal)
    if (document.pages.length !== document.pageCount || document.pages.length === 0) {
      throw new TinfoilDocumentsError('Tinfoil document conversion returned an empty document.', 'TINFOIL_CONVERSION_FAILED')
    }
    const securityVerified = isVerified()
    if (this.requireVerification && !securityVerified) {
      throw new TinfoilDocumentsError(
        'Tinfoil document conversion finished without a verified enclave; nothing was cached.',
        'TINFOIL_ATTESTATION_FAILED',
      )
    }
    const tmpDir = join(this.root, `${TMP_PREFIX}${randomUUID()}`)
    try {
      const manifest = await this.writeEntry(tmpDir, key, source, document, securityVerified)
      const published = await this.publishEntry(tmpDir, finalDir, key, manifest)
      return this.remember(published, Date.now())
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      if (error instanceof TinfoilDocumentsError) throw error
      throw new TinfoilDocumentsError(
        `Could not write the Tinfoil document cache: ${errorText(error)}`,
        'CACHE_WRITE_FAILED',
        { cause: error },
      )
    }
  }

  private async writeEntry(
    tmpDir: string,
    key: string,
    source: CacheSource,
    document: ConvertedDocument,
    securityVerified: boolean,
  ): Promise<CacheManifest> {
    const pagesDir = join(tmpDir, PAGE_DIR)
    await mkdir(pagesDir, { recursive: true, mode: 0o700 })
    const pages: CachedPage[] = []
    let totalBytes = MANIFEST_OVERHEAD
    document.pages.forEach((page, index) => {
      if (page.page !== index + 1) {
        throw new TinfoilDocumentsError('Tinfoil document conversion returned inconsistent page numbers.', 'TINFOIL_CONVERSION_FAILED')
      }
      totalBytes += Buffer.byteLength(page.text, 'utf8')
      totalBytes += page.image?.byteLength ?? 0
    })
    if (totalBytes > this.maxBytes) {
      throw new TinfoilDocumentsError(
        `The converted document needs ${totalBytes} bytes, which exceeds maxCacheBytes (${this.maxBytes}). Raise maxCacheBytes or convert a smaller document.`,
        'CACHE_ENTRY_TOO_LARGE',
      )
    }
    for (const page of document.pages) {
      const base = String(page.page).padStart(3, '0')
      const textFile = `${PAGE_DIR}/${base}.md`
      const textBytes = Buffer.byteLength(page.text, 'utf8')
      await writeFile(join(pagesDir, `${base}.md`), page.text, { mode: 0o600 })
      let imageFile: string | undefined
      let imageBytes: number | undefined
      if (page.image !== undefined && page.image.byteLength > 0) {
        imageFile = `${PAGE_DIR}/${base}.png`
        imageBytes = page.image.byteLength
        await writeFile(join(pagesDir, `${base}.png`), page.image, { mode: 0o600 })
      }
      pages.push({
        page: page.page,
        textFile,
        textBytes,
        isScanned: page.isScanned,
        ...(imageFile === undefined ? {} : { imageFile }),
        ...(imageBytes === undefined ? {} : { imageBytes }),
      })
    }
    const now = new Date().toISOString()
    const manifest: CacheManifest = {
      version: MANIFEST_VERSION,
      cacheKey: key,
      converterIdentity: this.identity,
      securityVerified,
      sourceName: source.name,
      sourceExtension: source.extension,
      sourceMediaType: source.mediaType,
      sourceBytes: source.bytes,
      pageCount: pages.length,
      pages,
      totalBytes,
      createdAt: now,
      lastAccessed: now,
      ...(document.processingTimeMs === undefined ? {} : { processingTimeMs: document.processingTimeMs }),
    }
    await writeFile(join(tmpDir, MANIFEST_FILE), JSON.stringify(manifest), { mode: 0o600 })
    await syncPath(join(tmpDir, MANIFEST_FILE))
    await syncDirectory(tmpDir)
    return manifest
  }

  private async publishEntry(
    tmpDir: string,
    finalDir: string,
    key: string,
    manifest: CacheManifest,
  ): Promise<CacheManifest> {
    const existing = await this.readManifest(finalDir, key)
    if (existing !== undefined) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return existing
    }
    await rm(finalDir, { recursive: true, force: true }).catch(() => {})
    try {
      await rename(tmpDir, finalDir)
      return manifest
    } catch (error) {
      const raced = await this.readManifest(finalDir, key)
      if (raced !== undefined) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
        return raced
      }
      throw error
    }
  }

  private remember(manifest: CacheManifest, lastAccessed: number): CacheEntryMeta {
    if (manifest.totalBytes > this.maxBytes) {
      throw new TinfoilDocumentsError(
        `The converted document needs ${manifest.totalBytes} bytes, which exceeds maxCacheBytes (${this.maxBytes}). Raise maxCacheBytes or convert a smaller document.`,
        'CACHE_ENTRY_TOO_LARGE',
      )
    }
    const meta = this.metaFromManifest(manifest, lastAccessed)
    this.lru.set(meta.key, meta)
    this.scheduleFlush()
    return meta
  }

  private metaFromManifest(manifest: CacheManifest, lastAccessed: number): CacheEntryMeta {
    return {
      key: manifest.cacheKey,
      size: manifest.totalBytes,
      pageCount: manifest.pageCount,
      lastAccessed,
      pages: manifest.pages,
      securityVerified: manifest.securityVerified,
    }
  }

  private assertReadableEntry(entry: CacheEntryMeta): void {
    if (this.requireVerification && !entry.securityVerified) {
      throw new TinfoilDocumentsError(
        'Cached document was not produced by a verified enclave; converting it again.',
        'CACHE_CORRUPTED',
      )
    }
  }

  private async assertRegularFile(path: string, expectedBytes: number | undefined): Promise<void> {
    const info = await lstat(path)
    if (!info.isFile()) {
      throw new TinfoilDocumentsError('Cached page is not a regular file.', 'CACHE_CORRUPTED')
    }
    if (expectedBytes !== undefined && info.size > expectedBytes + 1024) {
      throw new TinfoilDocumentsError('Cached page is larger than its manifest allows.', 'CACHE_CORRUPTED')
    }
  }

  private entryPath(key: string, relative: string): string {
    const base = join(this.root, key)
    const path = resolve(base, ...relative.split('/'))
    if (path !== base && !path.startsWith(`${base}${sep}`)) {
      throw new TinfoilDocumentsError('Cached page path leaves its entry directory.', 'CACHE_CORRUPTED')
    }
    return path
  }

  private async readManifest(dir: string, key: string): Promise<CacheManifest | undefined> {
    try {
      const text = await readFile(join(dir, MANIFEST_FILE), 'utf8')
      const value: unknown = JSON.parse(text)
      if (!isRecord(value) || value.version !== MANIFEST_VERSION || value.cacheKey !== key) return undefined
      if (value.converterIdentity !== this.identity) return undefined
      const securityVerified = value.securityVerified
      if (typeof securityVerified !== 'boolean') return undefined
      if (this.requireVerification && securityVerified !== true) return undefined
      const sourceName = value.sourceName
      const sourceExtension = value.sourceExtension
      const sourceMediaType = value.sourceMediaType
      const sourceBytes = value.sourceBytes
      const pageCount = value.pageCount
      const totalBytes = value.totalBytes
      if (typeof sourceName !== 'string' || typeof sourceExtension !== 'string' || typeof sourceMediaType !== 'string') return undefined
      if (!isCount(sourceBytes) || !isPositiveCount(pageCount) || !isPositiveCount(totalBytes)) return undefined
      const rawPages = value.pages
      if (!Array.isArray(rawPages) || rawPages.length !== pageCount) return undefined
      const pages: CachedPage[] = []
      const seen = new Set<number>()
      for (const raw of rawPages) {
        if (!isRecord(raw)) return undefined
        const page = raw.page
        const textFile = raw.textFile
        const textBytes = raw.textBytes
        if (!isPositiveCount(page) || page > pageCount || seen.has(page)) return undefined
        if (typeof textFile !== 'string' || !isSafeRelative(textFile, PAGE_DIR)) return undefined
        if (!isCount(textBytes)) return undefined
        const imageFile = raw.imageFile
        const imageBytes = raw.imageBytes
        if (imageFile !== undefined && (typeof imageFile !== 'string' || !isSafeRelative(imageFile, PAGE_DIR))) return undefined
        if (imageBytes !== undefined && !isCount(imageBytes)) return undefined
        pages.push({
          page,
          textFile,
          textBytes,
          isScanned: raw.isScanned === true,
          ...(typeof imageFile === 'string' ? { imageFile } : {}),
          ...(typeof imageBytes === 'number' ? { imageBytes } : {}),
        })
        seen.add(page)
      }
      pages.sort((left, right) => left.page - right.page)
      if (pages.some((page, index) => page.page !== index + 1)) return undefined
      const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
      const lastAccessed = typeof value.lastAccessed === 'string' ? value.lastAccessed : createdAt
      const processingTimeMs = typeof value.processingTimeMs === 'number' && Number.isFinite(value.processingTimeMs)
        ? Math.max(0, Math.round(value.processingTimeMs))
        : undefined
      return {
        version: MANIFEST_VERSION,
        cacheKey: key,
        converterIdentity: this.identity,
        securityVerified,
        sourceName,
        sourceExtension,
        sourceMediaType,
        sourceBytes,
        pageCount,
        pages,
        totalBytes,
        createdAt,
        lastAccessed,
        ...(processingTimeMs === undefined ? {} : { processingTimeMs }),
      }
    } catch {
      return undefined
    }
  }

  private async readIndex(): Promise<Map<string, number>> {
    try {
      const text = await readFile(join(this.root, INDEX_FILE), 'utf8')
      const value: unknown = JSON.parse(text)
      const entries = new Map<string, number>()
      if (!isRecord(value)) return entries
      const raw = value.entries
      if (!isRecord(raw)) return entries
      for (const [key, entry] of Object.entries(raw)) {
        if (!HEX64.test(key) || !isRecord(entry)) continue
        const lastAccessed = entry.lastAccessed
        if (typeof lastAccessed === 'number' && Number.isFinite(lastAccessed)) entries.set(key, lastAccessed)
      }
      return entries
    } catch {
      return new Map()
    }
  }

  private scheduleFlush(): void {
    if (!this.ready || this.disposed || this.flushTimer !== undefined) return
    const timer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flushIndex()
    }, INDEX_FLUSH_MS)
    timer.unref()
    this.flushTimer = timer
  }

  private async flushIndex(): Promise<void> {
    if (!this.ready) return
    const entries: Record<string, IndexEntry> = {}
    for (const [key, meta] of this.lru.entries()) {
      entries[key] = { size: meta.size, lastAccessed: meta.lastAccessed, pageCount: meta.pageCount }
    }
    const target = join(this.root, INDEX_FILE)
    const temp = join(this.root, `${INDEX_TMP_PREFIX}${process.pid}-${randomUUID()}`)
    try {
      await writeFile(temp, JSON.stringify({ version: INDEX_VERSION, entries }), { mode: 0o600 })
      await rename(temp, target)
    } catch {
      await rm(temp, { force: true }).catch(() => {})
    }
  }
}
