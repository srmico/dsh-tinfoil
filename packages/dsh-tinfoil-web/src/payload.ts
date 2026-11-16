import type { WebError, WebFetchResult, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import {
  MAX_FETCH_URL_LENGTH,
  MAX_SEARCH_RESULTS,
} from './config.js'
import {
  blockedUrl,
  invalidResponse,
  invalidUrl,
  sanitizeDetail,
  toolFailed,
} from './errors.js'
import type { WebTransport } from './errors.js'

/** Structural subset of an MCP `CallToolResult` used by the mappers. */
export interface ToolResult {
  readonly isError?: boolean
  readonly structuredContent?: unknown
  readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[]
}

/** One fetched page before it is shaped into a seam result. */
export interface FetchedPage {
  readonly url: string
  readonly content: string
  readonly truncated: boolean
}

/** Per-URL fetch outcome; exactly one of `page` or `error` is present. */
export type PageOutcome =
  | { readonly page: FetchedPage }
  | { readonly error: WebError }

/** Fetch outcomes keyed by the requested URL string. */
export type PageOutcomes = ReadonlyMap<string, PageOutcome>

/** Clamped result count and whether the provider cap shortened it. */
export interface ClampedResults {
  readonly maxResults?: number
  readonly truncated: boolean
}

/**
 * Clamp a requested result count to the provider's 1..30 range.
 * @param value - the consumer's requested count.
 * @returns the count to send and whether it exceeded the provider cap.
 */
export function clampMaxResults(value: number | undefined): ClampedResults {
  if (value === undefined || !Number.isFinite(value)) return { truncated: false }
  const maxResults = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(value)))
  return { maxResults, truncated: value > MAX_SEARCH_RESULTS }
}

/**
 * Validate a fetch URL against the seam's transport policy.
 * @param input - the raw model-supplied URL.
 * @returns the normalized URL string.
 */
export function validateFetchUrl(input: string): string {
  const raw = input.trim()
  if (raw.length === 0) throw invalidUrl('empty URL')
  if (raw.length > MAX_FETCH_URL_LENGTH) {
    throw invalidUrl(`URL exceeds the maximum length of ${MAX_FETCH_URL_LENGTH}`)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch (error: unknown) {
    throw invalidUrl(sanitizeDetail(raw), error)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalidUrl(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`)
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw blockedUrl('credentials in URLs are not allowed')
  }
  return url.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function textField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function firstText(result: ToolResult): string | undefined {
  for (const block of result.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) return block.text
  }
  return undefined
}

function structuredRecord(result: ToolResult): Record<string, unknown> | undefined {
  return isRecord(result.structuredContent) ? result.structuredContent : undefined
}

function jsonTextPayload(result: ToolResult): Record<string, unknown> | undefined {
  const text = firstText(result)
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function ensureNotError(result: ToolResult, transport: WebTransport, operation: 'search' | 'fetch'): void {
  if (result.isError !== true) return
  throw toolFailed(transport, operation, sanitizeDetail(firstText(result)))
}

function truncateCodePoints(value: string, max: number): string {
  const points = Array.from(value)
  return points.length <= max ? value : points.slice(0, max).join('')
}

function piiNote(payload: Record<string, unknown>, resultCount: number): string | undefined {
  if (payload.pii_masked !== true) return undefined
  const redactions = payload.pii_redactions
  const count = Array.isArray(redactions) ? redactions.length : 0
  const spans = count > 0
    ? `${count} sensitive span${count === 1 ? '' : 's'}`
    : 'some sensitive spans'
  if (resultCount === 0) {
    const emptied = typeof payload.redacted_query === 'string' && payload.redacted_query.trim().length === 0
    return emptied
      ? `Privacy filtering removed ${spans} from the search query, so no search was performed.`
      : `Privacy filtering removed ${spans} from the search query; no results were returned.`
  }
  return `Privacy filtering removed ${spans} from the search query before it was sent.`
}

function mapTinfoilSource(raw: unknown): WebSearchSource | undefined {
  if (!isRecord(raw)) return undefined
  const url = stringField(raw, 'url')
  if (url === undefined || !isHttpUrl(url)) return undefined
  const title = nonEmpty(stringField(raw, 'title'))
  const content = nonEmpty(stringField(raw, 'content'))
  const publishedAt = nonEmpty(stringField(raw, 'published_date'))
  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...(content === undefined ? {} : { snippet: truncateCodePoints(content, 300), summary: content }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

/**
 * Map an attested `search` tool result to the seam's search shape.
 * @param result - the MCP tool result.
 * @param maxResults - the clamped result count, if one was requested.
 * @param clampedByProvider - whether the requested count exceeded 30.
 * @returns the normalized search result.
 */
export function mapTinfoilSearch(
  result: ToolResult,
  maxResults: number | undefined,
  clampedByProvider: boolean,
): WebSearchResult {
  ensureNotError(result, 'tinfoil', 'search')
  const payload = structuredRecord(result) ?? jsonTextPayload(result)
  if (payload === undefined) throw invalidResponse('tinfoil')
  const rawResults = Array.isArray(payload.results) ? payload.results : []
  const cap = maxResults ?? MAX_SEARCH_RESULTS
  const sources: WebSearchSource[] = []
  for (const raw of rawResults) {
    if (sources.length >= cap) break
    const source = mapTinfoilSource(raw)
    if (source !== undefined) sources.push(source)
  }
  const dropped = rawResults.length > cap
  const note = piiNote(payload, sources.length)
  return {
    ...(note === undefined ? {} : { content: note }),
    sources,
    truncated: clampedByProvider || dropped,
  }
}

function stripExaNotes(text: string): string {
  let body = text
  for (;;) {
    const trimmed = body.trimStart()
    if (!trimmed.startsWith('Note:')) return trimmed
    const newline = trimmed.indexOf('\n')
    if (newline === -1) return ''
    body = trimmed.slice(newline + 1)
  }
}

function parseExaSearchBlock(block: string): WebSearchSource | undefined {
  const lines = block.split('\n')
  let title: string | undefined
  let url: string | undefined
  let publishedAt: string | undefined
  let contentMode: 'highlights' | 'text' | undefined
  const content: string[] = []
  for (const line of lines) {
    if (contentMode === undefined) {
      if (line.startsWith('Title: ')) { title = line.slice(7).trim(); continue }
      if (line.startsWith('URL: ')) { url = line.slice(5).trim(); continue }
      if (line.startsWith('Published: ')) { publishedAt = line.slice(11).trim(); continue }
      if (line.startsWith('Author: ')) continue
      if (line === 'Highlights:' || line.startsWith('Highlights:')) { contentMode = 'highlights'; continue }
      if (line.startsWith('Text: ')) { contentMode = 'text'; const rest = line.slice(6).trim(); if (rest.length > 0) content.push(rest); continue }
      continue
    }
    content.push(line)
  }
  if (url === undefined || !isHttpUrl(url)) return undefined
  const body = content.join('\n').trim()
  const safeTitle = title === undefined || title === 'N/A' ? undefined : nonEmpty(title)
  const safePublished = publishedAt === undefined || publishedAt === 'N/A' ? undefined : nonEmpty(publishedAt)
  return {
    url,
    ...(safeTitle === undefined ? {} : { title: safeTitle }),
    ...(body.length === 0 ? {} : { snippet: truncateCodePoints(body, 300), summary: body }),
    ...(safePublished === undefined ? {} : { publishedAt: safePublished }),
  }
}

/**
 * Map an Exa MCP `web_search_exa` text result to the seam's search shape.
 * @param result - the MCP tool result.
 * @param maxResults - the clamped result count, if one was requested.
 * @param clampedByProvider - whether the requested count exceeded 30.
 * @returns the normalized search result.
 */
export function mapExaSearch(
  result: ToolResult,
  maxResults: number | undefined,
  clampedByProvider: boolean,
): WebSearchResult {
  ensureNotError(result, 'endpoint', 'search')
  const text = firstText(result)
  if (text === undefined) throw invalidResponse('endpoint')
  const body = stripExaNotes(text)
  if (body.length === 0) return { sources: [], truncated: clampedByProvider }
  if (/^No search results found\b/u.test(body)) return { sources: [], truncated: clampedByProvider }
  const cap = maxResults ?? MAX_SEARCH_RESULTS
  const blocks = body.split(/\n\n---\n\n/u)
  const sources: WebSearchSource[] = []
  for (const block of blocks) {
    if (sources.length >= cap) break
    const source = parseExaSearchBlock(block)
    if (source !== undefined) sources.push(source)
  }
  return { sources, truncated: clampedByProvider || blocks.length > cap }
}

function pageContent(raw: string, maxPageChars: number): { content: string; truncated: boolean } {
  const content = truncateCodePoints(raw, maxPageChars)
  return { content, truncated: content.length !== raw.length }
}

function makePage(url: string, raw: string, maxPageChars: number): FetchedPage {
  const { content, truncated } = pageContent(raw, maxPageChars)
  return { url, content, truncated }
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value).href
  } catch {
    return undefined
  }
}

function tinfoilPageFor(
  payload: Record<string, unknown>,
  requestedUrl: string,
  requestedCount: number,
  maxPageChars: number,
): PageOutcome {
  const pages = Array.isArray(payload.pages) ? payload.pages.filter(isRecord) : []
  const results = Array.isArray(payload.results) ? payload.results.filter(isRecord) : []
  const requestedNormalized = normalizeUrl(requestedUrl)
  let match = pages.find(page => normalizeUrl(stringField(page, 'url')) === requestedNormalized)
  if (match === undefined && requestedCount === 1 && pages.length === 1) match = pages[0]
  if (match !== undefined) {
    const content = textField(match, 'content')
    if (content !== undefined) {
      const pageUrl = nonEmpty(stringField(match, 'url')) ?? requestedUrl
      return { page: makePage(isHttpUrl(pageUrl) ? pageUrl : requestedUrl, content, maxPageChars) }
    }
  }
  const failed = results.find(result => normalizeUrl(stringField(result, 'url')) === requestedNormalized)
  if (failed !== undefined) {
    const status = stringField(failed, 'status')
    const content = textField(failed, 'content')
    if (status === 'completed' && content !== undefined) {
      const pageUrl = nonEmpty(stringField(failed, 'url')) ?? requestedUrl
      return { page: makePage(isHttpUrl(pageUrl) ? pageUrl : requestedUrl, content, maxPageChars) }
    }
    if (status === 'failed') {
      return { error: toolFailed('tinfoil', 'fetch', sanitizeDetail(stringField(failed, 'error') ?? 'page fetch failed')) }
    }
  }
  return { error: toolFailed('tinfoil', 'fetch', `no page returned for ${requestedUrl}`) }
}

/**
 * Map an attested `fetch` tool result to per-URL page outcomes.
 * @param result - the MCP tool result.
 * @param urls - the requested URLs.
 * @param maxPageChars - per-page character cap.
 * @returns outcomes keyed by requested URL.
 */
export function mapTinfoilFetch(
  result: ToolResult,
  urls: readonly string[],
  maxPageChars: number,
): PageOutcomes {
  ensureNotError(result, 'tinfoil', 'fetch')
  const payload = structuredRecord(result) ?? jsonTextPayload(result)
  if (payload === undefined) throw invalidResponse('tinfoil')
  const outcomes = new Map<string, PageOutcome>()
  for (const url of urls) outcomes.set(url, tinfoilPageFor(payload, url, urls.length, maxPageChars))
  return outcomes
}

interface ExaPage {
  readonly title?: string
  readonly url: string
  readonly content: string
}

function parseExaPages(text: string): readonly ExaPage[] {
  const lines = text.split('\n')
  const pages: ExaPage[] = []
  let current: { title: string; url: string; content: string[] } | undefined
  const finish = (): void => {
    if (current === undefined) return
    const content = current.content.join('\n').trim()
    pages.push({
      title: current.title,
      url: current.url,
      content,
    })
    current = undefined
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.startsWith('# ')) {
      const next = lines[index + 1] ?? ''
      if (next.startsWith('URL: ')) {
        finish()
        current = { title: line.slice(2).trim(), url: next.slice(5).trim(), content: [] }
        index += 1
        continue
      }
    }
    if (/^Error fetching /u.test(line)) {
      finish()
      continue
    }
    if (current !== undefined) current.content.push(line)
  }
  finish()
  return pages
}

function parseExaErrorLines(text: string): ReadonlyMap<string, string> {
  const errors = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^Error fetching (\S+): (.*)$/u.exec(line.trim())
    if (match !== null && match[1] !== undefined) errors.set(match[1], match[2] ?? '')
  }
  return errors
}

/**
 * Map an Exa MCP `web_fetch_exa` text result to per-URL page outcomes.
 * @param result - the MCP tool result.
 * @param urls - the requested URLs.
 * @param maxPageChars - per-page character cap.
 * @returns outcomes keyed by requested URL.
 */
export function mapExaFetch(
  result: ToolResult,
  urls: readonly string[],
  maxPageChars: number,
): PageOutcomes {
  ensureNotError(result, 'endpoint', 'fetch')
  const text = firstText(result)
  if (text === undefined) throw invalidResponse('endpoint')
  const body = text.trim()
  const pages = parseExaPages(body)
  const errors = parseExaErrorLines(body)
  const noContent = /^No content found for the provided URL\(s\)\./u.test(body)
  const outcomes = new Map<string, PageOutcome>()
  for (const url of urls) {
    const normalized = normalizeUrl(url)
    const page = pages.find(candidate => normalizeUrl(candidate.url) === normalized)
      ?? (urls.length === 1 && pages.length === 1 ? pages[0] : undefined)
    if (page !== undefined) {
      const pageUrl = isHttpUrl(page.url) ? page.url : url
      outcomes.set(url, { page: makePage(pageUrl, page.content, maxPageChars) })
      continue
    }
    const error = errors.get(url) ?? errors.get(normalized ?? url)
    if (error !== undefined) {
      outcomes.set(url, { error: toolFailed('endpoint', 'fetch', sanitizeDetail(error)) })
      continue
    }
    if (noContent) {
      outcomes.set(url, { page: makePage(url, '', maxPageChars) })
      continue
    }
    if (urls.length === 1 && body.length > 0) {
      outcomes.set(url, { page: makePage(url, body, maxPageChars) })
      continue
    }
    outcomes.set(url, { error: toolFailed('endpoint', 'fetch', `no page returned for ${url}`) })
  }
  return outcomes
}

/**
 * Shape one fetched page into the seam's fetch result.
 * @param page - the fetched page.
 * @returns the seam result.
 */
export function toWebFetchResult(page: FetchedPage): WebFetchResult {
  return {
    url: page.url,
    statusCode: 200,
    body: { kind: 'text', content: page.content },
    truncated: page.truncated,
  }
}

/**
 * Last-resort error for a batch that returned no outcome for a URL.
 * @param transport - the active transport.
 * @param url - the requested URL.
 * @returns the typed error.
 */
export function missingPageError(transport: WebTransport, url: string): WebError {
  return toolFailed(transport, 'fetch', `no page returned for ${url}`)
}
