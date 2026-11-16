import type { Context } from '@deepseek-ai/cordis'
import type { VerificationDocument } from 'tinfoil'

/** How a plugin reaches its Tinfoil endpoint. */
export type TinfoilAttestationMode = 'sdk' | 'proxy' | 'endpoint' | 'direct'

/** Derived verification state of one plugin. */
export type TinfoilAttestationState =
  | 'idle'
  | 'pending'
  | 'verified'
  | 'failed'
  | 'external'
  | 'unattested'

/** One capability plugin's published verification surface. */
export interface TinfoilAttestationTarget {
  /** Stable plugin id, for example `documents` or `web`. */
  readonly id: string
  /** Human-readable capability title. */
  readonly title: string
  /** Optional one-line description of the attested capability. */
  readonly description?: string
  /** Transport and attestation mode of this plugin. */
  readonly mode: TinfoilAttestationMode
  /** Release repository verified by the host client; required for attested targets. */
  readonly configRepo?: string
  /** Enclave or endpoint origin; required for every non-router target. */
  readonly enclaveURL?: string
  /** Current verification document without starting network work. */
  read(): VerificationDocument | undefined
  /** Run this plugin's own attestation and return once the document is available. */
  verify?(signal: AbortSignal): Promise<void>
}

/** One plugin's state as the browser reads it. */
export interface TinfoilAttestationEntry {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly mode: TinfoilAttestationMode
  readonly configRepo?: string
  readonly enclaveURL: string
  readonly state: TinfoilAttestationState
  readonly document?: VerificationDocument
  readonly error?: string
  readonly verifying: boolean
  readonly canVerify: boolean
}

/** Canonical target id/title pairs for plugins that are not loaded. */
export interface TinfoilKnownTarget {
  readonly id: string
  readonly title: string
}

/** Known targets rendered as “Not loaded” when their plugin is absent. */
export const TINFOIL_KNOWN_TARGETS: readonly TinfoilKnownTarget[] = [
  { id: 'documents', title: 'Document conversion' },
  { id: 'pii', title: 'PII redaction' },
  { id: 'decisions', title: 'Decision outputs' },
  { id: 'audio', title: 'Audio transcription and speech' },
  { id: 'web', title: 'Web search and fetch' },
  { id: 'provider', title: 'Tinfoil model provider' },
]

/** Complete registry response. */
export interface TinfoilAttestationSnapshot {
  readonly version: 2
  readonly generatedAt: string
  readonly knownTargets: readonly TinfoilKnownTarget[]
  readonly entries: TinfoilAttestationEntry[]
}

/** Host-side registry consumed by the capability plugins and the verification page. */
export interface TinfoilAttestationRegistry {
  register(target: TinfoilAttestationTarget): () => void
  snapshot(): TinfoilAttestationSnapshot
  verify(id: string, signal: AbortSignal): Promise<TinfoilAttestationEntry>
}

/** Domain failure for a rejected registration or verification request. */
export class TinfoilAttestationError extends Error {
  constructor(
    readonly code: 'invalid-target' | 'duplicate-target' | 'unknown-target' | 'unsupported',
    message: string,
  ) {
    super(message)
    this.name = 'TinfoilAttestationError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tinfoilAttestation: TinfoilAttestationRegistry
  }
}

/**
 * Publish one plugin's verification surface when the verification plugin is mounted.
 * @param ctx - host plugin context.
 * @param target - this plugin's attestation target.
 */
export function registerTinfoilAttestation(ctx: Context, target: TinfoilAttestationTarget): void {
  ctx.inject(['tinfoilAttestation'], (attestationCtx) => {
    attestationCtx.effect(
      () => attestationCtx.tinfoilAttestation.register(target),
      `tinfoil ${target.id} attestation`,
    )
  })
}
