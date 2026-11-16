export const DEFAULT_API_KEY_ENV = 'TINFOIL_API_KEY'

export const MAX_TIMER_DELAY_MS = 2_147_483_647

export interface HttpUrlOptions {
  /** Prefix for diagnostics, for example `tinfoil-web: endpoint`. */
  readonly label: string
  /** Accept plain HTTP outside loopback. Off by default. */
  readonly allowInsecureHttp?: boolean
  /** Accept a query string. Off by default. */
  readonly allowQuery?: boolean
  /** Accept a fragment. Off by default. */
  readonly allowFragment?: boolean
}

/** Resolve a configured environment-variable name. */
export function resolveApiKeyEnv(value: string | undefined, label: string): string {
  const env = (value ?? DEFAULT_API_KEY_ENV).trim()
  if (env.length === 0) throw new Error(`${label} must not be empty`)
  return env
}

/** Require a positive integer. */
export function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

/** Require a non-empty trimmed string. */
export function nonEmptyString(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${label} must not be empty`)
  return trimmed
}

/** Whether a URL host is one of the accepted loopback spellings. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === '[::1]'
}

/**
 * Validate and normalize an absolute HTTP(S) URL.
 *
 * Plain HTTP is accepted only for loopback unless `allowInsecureHttp` is set;
 * credentials are always rejected, and query/fragment are opt-in.
 * @param value - raw configured URL.
 * @param options - label and transport policy.
 * @returns the normalized URL, or undefined when unset.
 */
export function resolveHttpUrl(value: string | undefined, options: HttpUrlOptions): string | undefined {
  if (value === undefined) return undefined
  const raw = value.trim()
  if (raw.length === 0) throw new Error(`${options.label} must be an absolute http(s) URL`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${options.label} must be an absolute http(s) URL`)
  }
  const rejectedParts = [
    options.allowQuery === true ? '' : 'query',
    options.allowFragment === true ? '' : 'fragment',
  ].filter(part => part.length > 0)
  const suffix = rejectedParts.length === 0
    ? ''
    : ` without ${rejectedParts.join(' or ')}`
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0
    || url.password.length > 0
    || (options.allowQuery !== true && url.search.length > 0)
    || (options.allowFragment !== true && url.hash.length > 0)
  ) {
    throw new Error(`${options.label} must be an absolute http(s) URL without credentials${suffix}`)
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname) && options.allowInsecureHttp !== true) {
    throw new Error(
      `${options.label} must use https unless it targets localhost or allowInsecureHttp is enabled`,
    )
  }
  return url.href.replace(/\/+$/u, '')
}
