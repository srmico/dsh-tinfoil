import { WebError } from '@deepseek-ai/dsh-web'
import { isAbortError, sanitizeDetail } from '@srmico/dsh-tinfoil-lib'

/** Which transport produced an error. */
export type WebTransport = 'tinfoil' | 'endpoint'

export { isAbortError, sanitizeDetail }

function withCause(message: string, code: string, cause: unknown): WebError {
  return cause === undefined ? new WebError(message, code) : new WebError(message, code, { cause })
}

/** Missing Tinfoil API key in attested mode. */
export function missingTinfoilKey(env: string): WebError {
  return new WebError(
    `Tinfoil websearch needs an API key. Set ${env} in the launch environment or $DSH_HOME/.env.`,
    'TINFOIL_API_KEY_MISSING',
  )
}

/** Missing optional endpoint API key when endpointApiKeyEnv was configured. */
export function missingEndpointKey(env: string): WebError {
  return new WebError(
    `The websearch endpoint API key is not set. Set ${env} or remove endpointApiKeyEnv from the web plugin configuration.`,
    'ENDPOINT_AUTH_FAILED',
  )
}

/** Attestation failed before any request was sent. */
export function attestationFailed(detail: string, cause?: unknown): WebError {
  return withCause(
    `Tinfoil websearch enclave attestation failed; no request was sent.${detail.length > 0 ? ` ${detail}` : ''}`,
    'TINFOIL_ATTESTATION_FAILED',
    cause,
  )
}

/** Tinfoil client configuration failed. */
export function tinfoilConfigurationFailed(detail: string, cause?: unknown): WebError {
  return withCause(
    `Tinfoil websearch client configuration failed.${detail.length > 0 ? ` ${detail}` : ''}`,
    'TINFOIL_CONFIGURATION_FAILED',
    cause,
  )
}

/** Short operation noun for timeout/abort messages. */
type Operation = 'search' | 'fetch'

/** Operation timed out. */
export function timeoutError(transport: WebTransport, operation: Operation, seconds: number): WebError {
  return new WebError(
    `The web ${operation} timed out after ${seconds} second${seconds === 1 ? '' : 's'}.`,
    transport === 'tinfoil' ? 'TINFOIL_TIMEOUT' : 'ENDPOINT_TIMEOUT',
  )
}

/** Operation was cancelled by its caller. */
export function abortedError(operation: Operation, cause?: unknown): WebError {
  return withCause(`web ${operation} aborted`, 'WEB_ABORTED', cause)
}

/** The request URL is not a valid HTTP(S) URL. */
export function invalidUrl(detail: string, cause?: unknown): WebError {
  return withCause(`invalid URL: ${detail}`, 'WEB_INVALID_URL', cause)
}

/** The request URL is valid but not allowed. */
export function blockedUrl(detail: string): WebError {
  return new WebError(detail, 'WEB_BLOCKED_URL')
}

/** A provider tool returned an error result. */
export function toolFailed(transport: WebTransport, operation: Operation, detail: string): WebError {
  const label = transport === 'tinfoil' ? 'Tinfoil websearch' : 'The websearch endpoint'
  const suffix = detail.length > 0 ? `: ${detail}` : '.'
  return new WebError(
    `${label} failed the web ${operation}${suffix}`,
    transport === 'tinfoil' ? 'TINFOIL_TOOL_ERROR' : 'ENDPOINT_TOOL_ERROR',
  )
}

/** The configured endpoint does not expose a required tool. */
export function endpointToolMissing(operation: Operation, available: readonly string[]): WebError {
  const names = available.length > 0 ? available.join(', ') : '(none)'
  return new WebError(
    `The configured websearch endpoint does not expose a ${operation} tool. Available tools: ${names}.`,
    'ENDPOINT_TOOL_MISSING',
  )
}

/** A response could not be parsed into the seam's result shape. */
export function invalidResponse(transport: WebTransport, detail?: string): WebError {
  const label = transport === 'tinfoil' ? 'Tinfoil websearch' : 'The websearch endpoint'
  return new WebError(
    `${label} returned an unexpected response.${detail === undefined || detail.length === 0 ? '' : ` ${detail}`}`,
    transport === 'tinfoil' ? 'TINFOIL_RESPONSE_INVALID' : 'ENDPOINT_RESPONSE_INVALID',
  )
}

/** A response exceeded the configured byte cap. */
export function responseTooLarge(transport: WebTransport, limit: number): WebError {
  return new WebError(
    `The web response exceeded ${limit} bytes; no result was returned.`,
    transport === 'tinfoil' ? 'TINFOIL_RESPONSE_TOO_LARGE' : 'ENDPOINT_RESPONSE_TOO_LARGE',
  )
}

/** Map one HTTP failure without exposing the provider body. */
export function httpError(transport: WebTransport, status: number, detail: string): WebError {
  const label = transport === 'tinfoil' ? 'Tinfoil websearch' : 'The websearch endpoint'
  const suffix = detail.length > 0 ? `: ${detail}` : '.'
  if (status === 401 || status === 403) {
    return new WebError(
      transport === 'tinfoil'
        ? 'Tinfoil websearch authentication failed (HTTP 401/403). Check TINFOIL_API_KEY and that the key is enabled for the websearch service.'
        : `The websearch endpoint rejected the request (HTTP ${status}). Check endpointApiKeyEnv or the endpoint's authentication.`,
      transport === 'tinfoil' ? 'TINFOIL_AUTH_FAILED' : 'ENDPOINT_AUTH_FAILED',
    )
  }
  if (status === 402) {
    return new WebError(
      transport === 'tinfoil'
        ? 'Tinfoil account billing is paused (HTTP 402). Check the Tinfoil dashboard; retrying will not help.'
        : 'The websearch endpoint requires billing attention (HTTP 402). Retrying will not help.',
      transport === 'tinfoil' ? 'TINFOIL_BILLING_PAUSED' : 'ENDPOINT_BILLING_PAUSED',
    )
  }
  if (status === 429) {
    return new WebError(
      transport === 'tinfoil'
        ? 'Tinfoil websearch rate limit exceeded (HTTP 429). Retry later.'
        : 'The websearch endpoint rate limit was exceeded (HTTP 429). Retry later or configure endpointApiKeyEnv for higher limits.',
      transport === 'tinfoil' ? 'TINFOIL_RATE_LIMITED' : 'ENDPOINT_RATE_LIMITED',
    )
  }
  if (status >= 500) {
    return new WebError(
      `${label} is unavailable (HTTP ${status}). Retry later.`,
      transport === 'tinfoil' ? 'TINFOIL_UNAVAILABLE' : 'ENDPOINT_UNAVAILABLE',
    )
  }
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new WebError(
      `${label} rejected the request (HTTP ${status})${suffix}`,
      transport === 'tinfoil' ? 'TINFOIL_REQUEST_REJECTED' : 'ENDPOINT_TOOL_ERROR',
    )
  }
  return new WebError(
    `${label} failed (HTTP ${status})${suffix}`,
    transport === 'tinfoil' ? 'TINFOIL_UNAVAILABLE' : 'ENDPOINT_UNAVAILABLE',
  )
}

/** A transport or provider is unavailable. */
export function unavailable(transport: WebTransport, detail?: string, cause?: unknown): WebError {
  const label = transport === 'tinfoil' ? 'Tinfoil websearch' : 'The websearch endpoint'
  return withCause(
    `${label} is unavailable.${detail === undefined || detail.length === 0 ? '' : ` ${detail}`}`,
    transport === 'tinfoil' ? 'TINFOIL_UNAVAILABLE' : 'ENDPOINT_UNAVAILABLE',
    cause,
  )
}

/** An unexpected provider failure with no safe provider detail. */
export function providerFailure(detail?: string, cause?: unknown): WebError {
  return withCause(
    `The web provider request failed.${detail === undefined || detail.length === 0 ? '' : ` ${detail}`}`,
    'WEB_PROVIDER_ERROR',
    cause,
  )
}
