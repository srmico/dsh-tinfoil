/** Service name carrying the provider's native web-search capability to the web plugin. */
export const TINFOIL_NATIVE_WEB_SEARCH = 'tinfoilNativeWebSearch'

/** Capability value provided while native web search is enabled. */
export interface TinfoilNativeWebSearchService {
  readonly enabled: true
  readonly provider: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tinfoilNativeWebSearch?: TinfoilNativeWebSearchService
  }
}
