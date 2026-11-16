import {
  TINFOIL_KNOWN_TARGETS,
  TINFOIL_ROUTER_CONFIG_REPO,
  TINFOIL_ROUTER_ORIGIN,
  TinfoilAttestationError,
} from '@srmico/dsh-tinfoil-lib'
import type {
  TinfoilAttestationEntry,
  TinfoilAttestationMode,
  TinfoilAttestationRegistry,
  TinfoilAttestationSnapshot,
  TinfoilAttestationState,
  TinfoilAttestationTarget,
  VerificationDocument,
} from '@srmico/dsh-tinfoil-lib'

export {
  TINFOIL_ROUTER_CONFIG_REPO,
  TINFOIL_ROUTER_ORIGIN,
  TinfoilAttestationError,
}
export type {
  TinfoilAttestationEntry,
  TinfoilAttestationMode,
  TinfoilAttestationRegistry,
  TinfoilAttestationSnapshot,
  TinfoilAttestationState,
  TinfoilAttestationTarget,
}

const VERIFY_TIMEOUT_MS = 60_000
const ERROR_DETAIL_CHARS = 400
const UNSAFE_DETAIL = /[\u0000-\u001f\u007f]+/gu

interface RegisteredTarget {
  readonly target: TinfoilAttestationTarget
  readonly configRepo?: string
  readonly enclaveURL: string
}

/** Concrete registry owned by the verification plugin row. */
export class TinfoilAttestationRegistryImpl implements TinfoilAttestationRegistry {
  private readonly targets = new Map<string, RegisteredTarget>()
  private readonly errors = new Map<string, string>()
  private readonly verifying = new Map<string, Promise<TinfoilAttestationEntry>>()

  register(target: TinfoilAttestationTarget): () => void {
    assertTarget(target)
    if (this.targets.has(target.id)) {
      throw new TinfoilAttestationError(
        'duplicate-target',
        `A Tinfoil attestation target with id "${target.id}" is already registered.`,
      )
    }
    const configRepo = target.configRepo
      ?? (target.mode === 'sdk' ? TINFOIL_ROUTER_CONFIG_REPO : undefined)
    const registered: RegisteredTarget = {
      target,
      ...(configRepo === undefined ? {} : { configRepo }),
      enclaveURL: target.enclaveURL ?? TINFOIL_ROUTER_ORIGIN,
    }
    this.targets.set(target.id, registered)
    return () => {
      this.targets.delete(target.id)
      this.errors.delete(target.id)
      this.verifying.delete(target.id)
    }
  }

  snapshot(): TinfoilAttestationSnapshot {
    return {
      version: 2,
      generatedAt: new Date().toISOString(),
      knownTargets: TINFOIL_KNOWN_TARGETS,
      entries: [...this.targets.values()].map(entry => this.entryOf(entry)),
    }
  }

  async verify(id: string, signal: AbortSignal): Promise<TinfoilAttestationEntry> {
    const registered = this.targets.get(id)
    if (registered === undefined) {
      throw new TinfoilAttestationError('unknown-target', `No Tinfoil attestation target has id "${id}".`)
    }
    if (registered.target.mode !== 'sdk' || registered.target.verify === undefined) {
      throw new TinfoilAttestationError(
        'unsupported',
        `"${registered.target.title}" is configured for ${registered.target.mode} mode and has no host-side attestation to run.`,
      )
    }
    const running = this.verifying.get(id)
    if (running !== undefined) return await running
    let operation: Promise<TinfoilAttestationEntry>
    operation = this.runVerify(registered, signal).finally(() => {
      if (this.verifying.get(id) === operation) this.verifying.delete(id)
    })
    this.verifying.set(id, operation)
    return await operation
  }

  private async runVerify(
    registered: RegisteredTarget,
    signal: AbortSignal,
  ): Promise<TinfoilAttestationEntry> {
    const target = registered.target
    this.errors.delete(target.id)
    const timeout = AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    const combined = AbortSignal.any([signal, timeout])
    try {
      await target.verify?.(combined)
    } catch (error) {
      this.errors.set(target.id, describeError(error))
    }
    return this.entryOf(registered)
  }

  private entryOf(registered: RegisteredTarget): TinfoilAttestationEntry {
    const { target } = registered
    const base = {
      id: target.id,
      title: target.title,
      ...(target.description === undefined ? {} : { description: target.description }),
      mode: target.mode,
      ...(registered.configRepo === undefined ? {} : { configRepo: registered.configRepo }),
      enclaveURL: registered.enclaveURL,
      verifying: this.verifying.has(target.id),
    }
    if (target.mode === 'proxy') {
      return { ...base, state: 'external', canVerify: false }
    }
    if (target.mode !== 'sdk') {
      return { ...base, state: 'unattested', canVerify: false }
    }
    const canVerify = target.verify !== undefined
    let document: VerificationDocument | undefined
    try {
      document = target.read()
    } catch (error) {
      return { ...base, state: 'failed', error: describeError(error), canVerify }
    }
    const failedStep = document === undefined ? undefined : firstFailedStep(document)
    if (document !== undefined && document.securityVerified) {
      this.errors.delete(target.id)
      return { ...base, state: 'verified', document, canVerify }
    }
    if (failedStep !== undefined || this.errors.has(target.id)) {
      const error = this.errors.get(target.id) ?? failedStep ?? 'Tinfoil verification failed.'
      return {
        ...base,
        state: 'failed',
        ...(document !== undefined && isMeaningful(document) ? { document } : {}),
        error,
        canVerify,
      }
    }
    if (document !== undefined && isMeaningful(document)) {
      return { ...base, state: 'pending', document, canVerify }
    }
    return { ...base, state: 'idle', canVerify }
  }
}

function assertTarget(target: TinfoilAttestationTarget): void {
  if (typeof target.id !== 'string' || target.id.trim() === '') {
    throw new TinfoilAttestationError('invalid-target', 'A Tinfoil attestation target needs a non-empty id.')
  }
  if (typeof target.title !== 'string' || target.title.trim() === '') {
    throw new TinfoilAttestationError('invalid-target', `Tinfoil attestation target "${target.id}" needs a title.`)
  }
  if (typeof target.read !== 'function') {
    throw new TinfoilAttestationError('invalid-target', `Tinfoil attestation target "${target.id}" needs a read function.`)
  }
  if (target.mode === 'sdk') {
    if (target.verify !== undefined && typeof target.verify !== 'function') {
      throw new TinfoilAttestationError('invalid-target', `Tinfoil attestation target "${target.id}" has an invalid verify function.`)
    }
    if (target.enclaveURL !== undefined && target.configRepo === undefined) {
      throw new TinfoilAttestationError(
        'invalid-target',
        `Tinfoil attestation target "${target.id}" sets enclaveURL without configRepo.`,
      )
    }
    if (target.configRepo !== undefined && target.enclaveURL === undefined) {
      throw new TinfoilAttestationError(
        'invalid-target',
        `Tinfoil attestation target "${target.id}" sets configRepo without enclaveURL.`,
      )
    }
    return
  }
  if (target.verify !== undefined) {
    throw new TinfoilAttestationError(
      'invalid-target',
      `Tinfoil attestation target "${target.id}" has ${target.mode} mode but declares a verify function.`,
    )
  }
  if (target.enclaveURL === undefined) {
    throw new TinfoilAttestationError(
      'invalid-target',
      `Tinfoil attestation target "${target.id}" needs an enclaveURL for ${target.mode} mode.`,
    )
  }
}

function firstFailedStep(document: VerificationDocument): string | undefined {
  for (const step of Object.values(document.steps)) {
    if (step?.status === 'failed') return step.error ?? 'A Tinfoil verification step failed.'
  }
  return undefined
}

function isMeaningful(document: VerificationDocument): boolean {
  return document.enclaveHost !== ''
    || document.releaseDigest !== ''
    || document.verifiedAt !== undefined
    || document.securityVerified
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const clean = message.replace(UNSAFE_DETAIL, ' ').replace(/\s+/gu, ' ').trim()
  return (clean.length === 0 ? 'Tinfoil verification failed.' : clean).slice(0, ERROR_DETAIL_CHARS)
}
