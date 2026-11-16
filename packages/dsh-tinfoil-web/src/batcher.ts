import type { WebFetchResult } from '@deepseek-ai/dsh-web'
import { abortedError, timeoutError, toolFailed } from './errors.js'
import type { WebTransport } from './errors.js'
import { missingPageError, toWebFetchResult } from './payload.js'
import type { PageOutcomes } from './payload.js'

/** Call one upstream multi-URL fetch. */
export type FetchPages = (urls: readonly string[], signal: AbortSignal) => Promise<PageOutcomes>

/** Resolved batching behavior. */
export interface FetchBatcherOptions {
  readonly transport: WebTransport
  readonly enabled: boolean
  readonly windowMs: number
  readonly maxUrls: number
  readonly timeoutMs: number
}

interface Pending {
  readonly url: string
  readonly signal: AbortSignal
  readonly resolve: (result: WebFetchResult) => void
  readonly reject: (error: unknown) => void
  detach: () => void
}

/**
 * Coalesce concurrent single-URL fetch calls into one upstream multi-URL call.
 *
 * A request waits for the configured window (or until `maxUrls` accumulate),
 * then the batch is sent once. Each caller keeps its own cancellation: one
 * abort rejects only that caller, and the upstream call aborts when every
 * caller in the batch has aborted.
 */
export class FetchBatcher {
  private pending: Pending[] = []
  private timer: NodeJS.Timeout | undefined
  private flushing = false
  private closed = false

  constructor(
    private readonly fetchPages: FetchPages,
    private readonly options: FetchBatcherOptions,
  ) {}

  /**
   * Fetch one URL through the current batch.
   * @param url - the validated URL.
   * @param signal - the caller's cancellation/deadline signal.
   * @returns the fetched page as a seam result.
   */
  async request(url: string, signal: AbortSignal): Promise<WebFetchResult> {
    if (this.closed) throw toolFailed(this.options.transport, 'fetch', 'the web client is closed')
    if (signal.aborted) throw abortedError('fetch', signal.reason)
    if (!this.options.enabled) return await this.fetchOne(url, signal)
    return await new Promise<WebFetchResult>((resolve, reject) => {
      const entry: Pending = {
        url,
        signal,
        resolve,
        reject,
        detach: () => {},
      }
      const onAbort = (): void => {
        this.pending = this.pending.filter(item => item !== entry)
        entry.detach()
        if (this.pending.length === 0) this.clearTimer()
        reject(abortedError('fetch', signal.reason))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      entry.detach = () => signal.removeEventListener('abort', onAbort)
      this.pending.push(entry)
      if (this.pending.length >= this.options.maxUrls) this.flush()
      else this.schedule()
    })
  }

  /** Reject every pending caller and stop accepting new work. */
  close(): void {
    this.closed = true
    this.clearTimer()
    const pending = this.pending
    this.pending = []
    for (const entry of pending) {
      entry.detach()
      entry.reject(abortedError('fetch'))
    }
  }

  private async fetchOne(url: string, signal: AbortSignal): Promise<WebFetchResult> {
    const outcomes = await this.fetchPages([url], signal)
    const outcome = outcomes.get(url)
    if (outcome === undefined) throw missingPageError(this.options.transport, url)
    if ('page' in outcome) return toWebFetchResult(outcome.page)
    throw outcome.error
  }

  private schedule(): void {
    if (this.timer !== undefined || this.closed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.options.windowMs)
    this.timer.unref()
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private flush(): void {
    this.clearTimer()
    if (this.flushing || this.closed || this.pending.length === 0) return
    this.flushing = true
    const queued = this.pending.splice(0, this.options.maxUrls)
    const batch = queued.filter(entry => !entry.signal.aborted)
    for (const entry of queued) {
      if (!entry.signal.aborted) continue
      entry.detach()
      entry.reject(abortedError('fetch', entry.signal.reason))
    }
    if (batch.length === 0) {
      this.flushing = false
      if (this.pending.length > 0) this.schedule()
      return
    }
    const controller = new AbortController()
    let active = batch.length
    const detachers: Array<() => void> = []
    for (const entry of batch) {
      const onAbort = (): void => {
        active -= 1
        if (active === 0) controller.abort(entry.signal.reason)
      }
      entry.signal.addEventListener('abort', onAbort, { once: true })
      detachers.push(() => entry.signal.removeEventListener('abort', onAbort))
    }
    if (active === 0) {
      this.finish(batch, detachers)
      this.flushing = false
      for (const entry of batch) entry.reject(abortedError('fetch'))
      if (this.pending.length > 0) this.schedule()
      return
    }
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const signal = AbortSignal.any([controller.signal, timeout])
    void this.fetchPages(batch.map(entry => entry.url), signal).then((outcomes) => {
      for (const entry of batch) {
        if (entry.signal.aborted) continue
        const outcome = outcomes.get(entry.url)
        if (outcome === undefined) entry.reject(missingPageError(this.options.transport, entry.url))
        else if ('page' in outcome) entry.resolve(toWebFetchResult(outcome.page))
        else entry.reject(outcome.error)
      }
    }).catch((error: unknown) => {
      const mapped = timeout.aborted
        ? timeoutError(this.options.transport, 'fetch', Math.max(1, Math.round(this.options.timeoutMs / 1000)))
        : controller.signal.aborted
          ? abortedError('fetch')
          : error
      for (const entry of batch) {
        if (!entry.signal.aborted) entry.reject(mapped)
      }
    }).finally(() => {
      this.finish(batch, detachers)
      this.flushing = false
      if (this.pending.length > 0) this.schedule()
    })
  }

  private finish(batch: readonly Pending[], detachers: readonly (() => void)[]): void {
    for (const detach of detachers) detach()
    for (const entry of batch) entry.detach()
  }
}
