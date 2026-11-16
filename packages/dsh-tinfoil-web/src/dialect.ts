import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import {
  EXA_FETCH_TOOL,
  EXA_SEARCH_TOOL,
  TINFOIL_FETCH_TOOL,
  TINFOIL_SEARCH_TOOL,
} from './config.js'
import {
  mapExaFetch,
  mapExaSearch,
  mapTinfoilFetch,
  mapTinfoilSearch,
} from './payload.js'
import type { PageOutcomes, ToolResult } from './payload.js'

/** Wire dialect of one MCP tool. */
export type ToolDialect = 'tinfoil' | 'exa'

/** One bound MCP tool. */
export interface ToolSpec {
  readonly name: string
  readonly dialect: ToolDialect
}

/** Search and fetch tools bound for one endpoint. */
export interface ToolBinding {
  readonly search?: ToolSpec
  readonly fetch?: ToolSpec
}

/** Binding for the attested Tinfoil websearch server. */
export function tinfoilBinding(): ToolBinding {
  return {
    search: { name: TINFOIL_SEARCH_TOOL, dialect: 'tinfoil' },
    fetch: { name: TINFOIL_FETCH_TOOL, dialect: 'tinfoil' },
  }
}

/**
 * Bind the first matching tool names from an exposed list.
 * @param names - the endpoint's tool names.
 * @returns the search/fetch binding; a capability is absent when no matching tool exists.
 */
export function bindingFromTools(names: ReadonlySet<string>): ToolBinding {
  const search = names.has(EXA_SEARCH_TOOL)
    ? { name: EXA_SEARCH_TOOL, dialect: 'exa' as const }
    : names.has(TINFOIL_SEARCH_TOOL)
      ? { name: TINFOIL_SEARCH_TOOL, dialect: 'tinfoil' as const }
      : undefined
  const fetch = names.has(EXA_FETCH_TOOL)
    ? { name: EXA_FETCH_TOOL, dialect: 'exa' as const }
    : names.has(TINFOIL_FETCH_TOOL)
      ? { name: TINFOIL_FETCH_TOOL, dialect: 'tinfoil' as const }
      : undefined
  return {
    ...(search === undefined ? {} : { search }),
    ...(fetch === undefined ? {} : { fetch }),
  }
}

/**
 * Build tool arguments for one search.
 * @param spec - the bound search tool.
 * @param query - the search query.
 * @param maxResults - the clamped result count, if any.
 * @returns the tool arguments.
 */
export function searchArgs(
  spec: ToolSpec,
  query: string,
  maxResults: number | undefined,
): Record<string, unknown> {
  if (spec.dialect === 'exa') {
    return { query, ...(maxResults === undefined ? {} : { numResults: maxResults }) }
  }
  return { query, ...(maxResults === undefined ? {} : { max_results: maxResults }) }
}

/**
 * Build tool arguments for one multi-URL fetch.
 * @param spec - the bound fetch tool.
 * @param urls - the URLs to fetch.
 * @param maxPageChars - the per-page character cap.
 * @returns the tool arguments.
 */
export function fetchArgs(
  spec: ToolSpec,
  urls: readonly string[],
  maxPageChars: number,
): Record<string, unknown> {
  if (spec.dialect === 'exa') return { urls: [...urls], maxCharacters: maxPageChars }
  return { urls: [...urls] }
}

/**
 * Map a search result through the bound dialect.
 * @param spec - the bound search tool.
 * @param result - the MCP tool result.
 * @param maxResults - the clamped count, if any.
 * @param clampedByProvider - whether the requested count exceeded 30.
 * @returns the normalized search result.
 */
export function mapSearch(
  spec: ToolSpec,
  result: ToolResult,
  maxResults: number | undefined,
  clampedByProvider: boolean,
): WebSearchResult {
  return spec.dialect === 'exa'
    ? mapExaSearch(result, maxResults, clampedByProvider)
    : mapTinfoilSearch(result, maxResults, clampedByProvider)
}

/**
 * Map a fetch result through the bound dialect.
 * @param spec - the bound fetch tool.
 * @param result - the MCP tool result.
 * @param urls - the requested URLs.
 * @param maxPageChars - the per-page character cap.
 * @returns per-URL outcomes.
 */
export function mapFetch(
  spec: ToolSpec,
  result: ToolResult,
  urls: readonly string[],
  maxPageChars: number,
): PageOutcomes {
  return spec.dialect === 'exa'
    ? mapExaFetch(result, urls, maxPageChars)
    : mapTinfoilFetch(result, urls, maxPageChars)
}
