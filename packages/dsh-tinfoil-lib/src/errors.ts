import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Failure classes shared by every Tinfoil transport. */
export type TinfoilTransportErrorCode =
  | 'TINFOIL_API_KEY_MISSING'
  | 'TINFOIL_ATTESTATION_FAILED'
  | 'TINFOIL_CONFIGURATION_FAILED'
  | 'TINFOIL_UNAVAILABLE'
  | 'TINFOIL_TIMEOUT'
  | 'TINFOIL_AUTH_FAILED'
  | 'TINFOIL_BILLING_PAUSED'
  | 'TINFOIL_QUOTA_EXCEEDED'
  | 'TINFOIL_RATE_LIMITED'
  | 'TINFOIL_REQUEST_REJECTED'
  | 'TINFOIL_REDIRECT_REJECTED'
  | 'TINFOIL_RESPONSE_INVALID'
  | 'TINFOIL_RESPONSE_TOO_LARGE'

/**
 * Base error for Tinfoil transport and attestation failures.
 *
 * Plugin packages subclass it with their own code union so callers keep
 * domain-specific codes while sharing the transport implementation.
 */
export class TinfoilError<Code extends string = string> extends HarnessError {
  override readonly code: Code

  constructor(message: string, code: Code, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** Creates the error type owned by one plugin. */
export type TinfoilErrorFactory = (
  message: string,
  code: TinfoilTransportErrorCode,
  options?: ErrorOptions,
) => TinfoilError
