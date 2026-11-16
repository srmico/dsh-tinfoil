import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { TinfoilDecisionsClient } from './client.js'
import type { GateErrorAction, ResolvedConfig, ResolvedGateRule } from './config.js'
import { TinfoilDecisionsError } from './errors.js'
import type { DecisionAnswer, DecisionQuestion } from './payload.js'

/** One rule whose threshold was met. */
export interface GateReason {
  readonly question: string
  readonly probability: number
  readonly threshold: number
  readonly action: 'ask' | 'deny'
}

export type GateEvaluation =
  | { readonly kind: 'allow' }
  | { readonly kind: 'refusal' }
  | { readonly kind: 'triggered'; readonly action: 'ask' | 'deny'; readonly reasons: GateReason[] }

export interface GateDependencies {
  config: ResolvedConfig
  client: TinfoilDecisionsClient
}

const MAX_REASON_ITEM_CHARS = 200
const MAX_REASONS_SHOWN = 3
const MAX_ERROR_CHARS = 300

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Match one `*`-wildcard tool-name pattern; matching is exact and case-sensitive. */
export function matchToolName(pattern: string, name: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === name
  const expression = pattern.split('*').map(escapeRegExp).join('.*')
  return new RegExp(`^${expression}$`, 'u').test(name)
}

/** Whether any pattern matches one tool name. */
export function matchesAny(patterns: readonly string[], name: string): boolean {
  return patterns.some(pattern => matchToolName(pattern, name))
}

/** Truncate text at a UTF-8 boundary and append an explicit marker when needed. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const marker = '[truncated]'
  if (maxBytes <= Buffer.byteLength(marker, 'utf8')) return marker.slice(0, Math.max(0, maxBytes))
  const budget = maxBytes - Buffer.byteLength(marker, 'utf8')
  let used = 0
  let cut = ''
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > budget) break
    used += bytes
    cut += character
  }
  return `${cut}${marker}`
}

/** Build the bounded decision input for one pending tool call. */
export function buildGateInput(name: string, args: unknown, maxBytes: number): string {
  let serialized: string
  try {
    serialized = JSON.stringify(args) ?? 'null'
  } catch {
    serialized = '"[unserializable arguments]"'
  }
  return truncateUtf8(`Pending tool call:\ntool: ${name}\narguments: ${serialized}`, maxBytes)
}

function formatGateNumber(value: number): string {
  return String(Number(value.toFixed(3)))
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  let end = maxChars - 1
  const code = normalized.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return `${normalized.slice(0, end)}…`
}

/** Summarize every triggered rule, bounded for an approval prompt or denial reason. */
export function formatGateReasons(reasons: readonly GateReason[]): string {
  const shown = reasons.slice(0, MAX_REASONS_SHOWN).map(reason =>
    `"${truncateText(reason.question, MAX_REASON_ITEM_CHARS)}" (p=${formatGateNumber(reason.probability)} >= ${formatGateNumber(reason.threshold)})`,
  )
  if (reasons.length > MAX_REASONS_SHOWN) {
    shown.push(`+${reasons.length - MAX_REASONS_SHOWN} more`)
  }
  return shown.join('; ')
}

/** Evaluate gate answers against the rules that produced them. Any refusal fails closed. */
export function evaluateGateOutcome(
  answers: readonly DecisionAnswer[],
  rules: readonly ResolvedGateRule[],
): GateEvaluation {
  if (answers.length !== rules.length) {
    throw new TinfoilDecisionsError(
      `The decision gate received ${answers.length} answers for ${rules.length} rules.`,
      'TINFOIL_RESPONSE_INVALID',
    )
  }
  const triggered: GateReason[] = []
  for (const [index, rule] of rules.entries()) {
    const answer = answers[index]
    if (answer === undefined) {
      throw new TinfoilDecisionsError(
        'The decision gate received an incomplete answer list.',
        'TINFOIL_RESPONSE_INVALID',
      )
    }
    if (answer.type === 'refusal') return { kind: 'refusal' }
    if (answer.type !== 'predicate') {
      throw new TinfoilDecisionsError(
        `The decision gate received a ${answer.type} answer for a predicate rule.`,
        'TINFOIL_RESPONSE_INVALID',
      )
    }
    if (answer.probability >= rule.threshold) {
      triggered.push({
        question: rule.question,
        probability: answer.probability,
        threshold: rule.threshold,
        action: rule.action,
      })
    }
  }
  if (triggered.length === 0) return { kind: 'allow' }
  const action = triggered.some(reason => reason.action === 'deny') ? 'deny' : 'ask'
  return { kind: 'triggered', action, reasons: triggered }
}

function errorDetail(error: unknown): string {
  const value = error instanceof Error ? error.message : 'unknown error'
  const sanitized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  return sanitized.length === 0 ? 'unknown error' : sanitized.slice(0, MAX_ERROR_CHARS)
}

function failedDecision(
  exec: Readonly<ToolExecution>,
  error: unknown,
  onError: GateErrorAction,
  downstream: PreToolDecision,
): PreToolDecision {
  if (onError === 'allow') return downstream
  const detail = errorDetail(error)
  const reason = `Decision gate could not evaluate tool "${exec.name}"; its body was not executed: ${detail}`
  if (onError === 'deny') {
    return {
      kind: 'deny',
      reason,
      info: {
        name: 'TinfoilDecisionGateFailedError',
        code: 'TINFOIL_DECISION_GATE_FAILED',
        reason: detail,
      },
    }
  }
  return {
    kind: 'ask',
    reason,
    displayReason: { en: `Decision gate could not evaluate this call: ${detail}. Approve it?` },
  }
}

function deniedDecision(exec: Readonly<ToolExecution>, reasons: readonly GateReason[]): PreToolDecision {
  const detail = formatGateReasons(reasons)
  return {
    kind: 'deny',
    reason: `Decision gate denied tool "${exec.name}": ${detail}`,
    info: {
      name: 'TinfoilDecisionGateDeniedError',
      code: 'TINFOIL_DECISION_GATE_DENIED',
      reason: detail,
    },
  }
}

function askDecision(exec: Readonly<ToolExecution>, reasons: readonly GateReason[]): PreToolDecision {
  const detail = formatGateReasons(reasons)
  return {
    kind: 'ask',
    reason: `Decision gate flagged tool "${exec.name}": ${detail}`,
    displayReason: { en: `Decision gate flagged this call: ${detail}. Approve it?` },
  }
}

/** Install the opt-in predicate gate for matching pending tool calls. */
export function registerDecisionGate(ctx: Context, deps: GateDependencies): void {
  const gate = deps.config.gate
  if (!gate.enabled) return
  let accepting = true
  const active = new Set<Promise<void>>()
  const lifecycle = new AbortController()

  ctx.effect(function* () {
    const stopListener = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.agent === undefined || (exec.parent === undefined && exec.name === RUN_CODE_NAME)) {
        return next()
      }
      if (matchesAny(gate.exclude, exec.name)) return next()
      const rules = gate.rules.filter(rule => matchesAny(rule.tool, exec.name))
      if (rules.length === 0) return next()
      if (!accepting || lifecycle.signal.aborted) return { kind: 'cancel' }

      const completed = Promise.withResolvers<void>()
      active.add(completed.promise)
      try {
        const downstream = await next()
        if (downstream.kind !== 'allow') return downstream
        if (!accepting || lifecycle.signal.aborted) return { kind: 'cancel' }

        const signal = AbortSignal.any([exec.signal, lifecycle.signal])
        const questions: DecisionQuestion[] = rules.map((rule, index) => ({
          type: 'predicate',
          name: `rule_${index}`,
          instructions: rule.question,
        }))
        const outcome = await deps.client.decide({
          input: buildGateInput(exec.name, exec.arguments, gate.maxInputBytes),
          questions,
          model: gate.model,
          timeoutMs: gate.requestTimeoutMs,
          signal,
        }).then(
          result => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error }),
        )
        if (!accepting || lifecycle.signal.aborted) return { kind: 'cancel' }
        if (!outcome.ok) {
          if (exec.signal.aborted) return { kind: 'cancel' }
          return failedDecision(exec, outcome.error, gate.onError, downstream)
        }
        let evaluation: GateEvaluation
        try {
          evaluation = evaluateGateOutcome(outcome.result.answers, rules)
        } catch (error) {
          return failedDecision(exec, error, gate.onError, downstream)
        }
        if (evaluation.kind === 'allow') return downstream
        if (evaluation.kind === 'refusal') {
          return failedDecision(
            exec,
            new TinfoilDecisionsError(
              'Tinfoil declined to answer a gate question.',
              'TINFOIL_RESPONSE_INVALID',
            ),
            gate.onError,
            downstream,
          )
        }
        return evaluation.action === 'deny'
          ? deniedDecision(exec, evaluation.reasons)
          : askDecision(exec, evaluation.reasons)
      } finally {
        active.delete(completed.promise)
        completed.resolve()
      }
    })
    yield stopListener
    yield async () => {
      accepting = false
      lifecycle.abort(new Error('tinfoil-decisions gate disposed'))
      await Promise.allSettled([...active])
    }
  }, 'tinfoil-decisions gate lifecycle')
}
