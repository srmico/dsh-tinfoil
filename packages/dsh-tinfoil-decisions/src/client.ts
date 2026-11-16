import {
  TinfoilSecureClient,
  classifyHttpStatus,
  readProviderErrorBody,
  readTextCapped,
  responseTooLarge,
  type TinfoilTransportErrorCode,
  type VerificationDocument,
} from '@srmico/dsh-tinfoil-lib'
import type { DecisionModel } from './config.js'
import { TinfoilDecisionsError } from './errors.js'
import { buildDecisionBody, parseDecisionBody } from './payload.js'
import type { DecisionLimits, DecisionQuestion, DecisionResult } from './payload.js'

const DECISIONS_PATH = '/v1/decisions'

export interface TinfoilDecisionsClientOptions {
  apiKeyEnv: string
  defaultModel: DecisionModel
  maxInputBytes: number
  maxQuestions: number
  maxChoices: number
  maxScoreLevels: number
  maxRequestBytes: number
  maxResponseBytes: number
  requestTimeoutMs: number
}

export interface DecideInput {
  input: string
  questions: readonly DecisionQuestion[]
  model?: DecisionModel
  timeoutMs?: number
  signal: AbortSignal
}

function decisionsError(
  message: string,
  code: TinfoilTransportErrorCode,
  options?: ErrorOptions,
): TinfoilDecisionsError {
  return new TinfoilDecisionsError(message, code, options)
}

export class TinfoilDecisionsClient {
  private readonly client: TinfoilSecureClient
  private readonly options: TinfoilDecisionsClientOptions
  private readonly limits: DecisionLimits

  constructor(options: TinfoilDecisionsClientOptions) {
    this.options = options
    this.client = new TinfoilSecureClient({
      apiKeyEnv: options.apiKeyEnv,
      requestTimeoutMs: options.requestTimeoutMs,
      label: 'Tinfoil decisions',
      error: decisionsError,
    })
    this.limits = {
      maxInputBytes: options.maxInputBytes,
      maxQuestions: options.maxQuestions,
      maxChoices: options.maxChoices,
      maxScoreLevels: options.maxScoreLevels,
      maxRequestBytes: options.maxRequestBytes,
    }
  }

  assertApiKey(): string {
    return this.client.assertApiKey()
  }

  async decide(input: DecideInput): Promise<DecisionResult> {
    this.client.assertApiKey()
    const model = input.model ?? this.options.defaultModel
    const body = buildDecisionBody(input.input, input.questions, model, this.limits)
    const timeoutMs = input.timeoutMs ?? this.options.requestTimeoutMs
    const response = await this.client.request(DECISIONS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, input.signal, true, timeoutMs)
    if (!response.ok) {
      const providerError = await readProviderErrorBody(response)
      throw this.httpError(response.status, providerError.code)
    }
    const text = await readTextCapped(response, {
      limit: this.options.maxResponseBytes,
      tooLarge: () => responseTooLarge(
        decisionsError,
        `Tinfoil decisions response exceeded ${this.options.maxResponseBytes} bytes; no answers were returned.`,
      ),
    })
    return parseDecisionBody(text, input.questions)
  }

  /** Current verification document, or undefined before this client is created. */
  verification(): VerificationDocument | undefined {
    return this.client.verification()
  }

  /** Attest the decisions enclave and return its verification document. */
  async attest(signal: AbortSignal): Promise<VerificationDocument> {
    return await this.client.attest(signal)
  }

  private httpError(status: number, code?: string): TinfoilDecisionsError {
    switch (classifyHttpStatus(status, code)) {
      case 'auth':
        return new TinfoilDecisionsError(
          `Tinfoil decisions authentication failed (HTTP ${status}). Check ${this.options.apiKeyEnv}; an expired key also returns this status.`,
          'TINFOIL_AUTH_FAILED',
        )
      case 'billing':
        return new TinfoilDecisionsError(
          'Tinfoil account billing is paused (HTTP 402). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_BILLING_PAUSED',
        )
      case 'not-found':
        return new TinfoilDecisionsError(
          'Tinfoil does not serve /v1/decisions for the configured model (HTTP 404). Check the decision model id.',
          'TINFOIL_MODEL_UNAVAILABLE',
        )
      case 'quota':
        return new TinfoilDecisionsError(
          'Tinfoil quota is exhausted (HTTP 429). Check the Tinfoil dashboard; retrying will not help.',
          'TINFOIL_QUOTA_EXCEEDED',
        )
      case 'too-large':
        return new TinfoilDecisionsError(
          'Tinfoil rejected the decision request as too large (HTTP 413). Reduce the input size or the number of questions.',
          'INPUT_TOO_LARGE',
        )
      case 'rate-limit':
        return new TinfoilDecisionsError(
          'Tinfoil rate limit exceeded (HTTP 429). Retry later.',
          'TINFOIL_RATE_LIMITED',
        )
      case 'request-rejected':
        return new TinfoilDecisionsError(
          `Tinfoil rejected the decision request (HTTP ${status}). Check the question types, choice counts, score levels, and input size.`,
          'TINFOIL_REQUEST_REJECTED',
        )
      case 'unavailable':
        return new TinfoilDecisionsError(
          `Tinfoil decisions is unavailable (HTTP ${status}). Retry later.`,
          'TINFOIL_UNAVAILABLE',
        )
      default:
        return new TinfoilDecisionsError(
          `Tinfoil decisions failed (HTTP ${status}).`,
          'TINFOIL_DECISION_FAILED',
        )
    }
  }
}
