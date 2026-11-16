import {
  DEFAULT_API_KEY_ENV,
  positiveInteger,
  resolveApiKeyEnv,
} from '@srmico/dsh-tinfoil-lib'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export type DecisionModel = 'decision-small' | 'decision-medium' | 'decision-large'

export type GateAction = 'ask' | 'deny'

export type GateErrorAction = 'deny' | 'ask' | 'allow'

export const DECISION_MODELS: readonly DecisionModel[] = [
  'decision-small',
  'decision-medium',
  'decision-large',
]

const GATE_ACTIONS: readonly GateAction[] = ['ask', 'deny']

const GATE_ERROR_ACTIONS: readonly GateErrorAction[] = ['deny', 'ask', 'allow']

/** One predicate rule evaluated before a matching tool call executes. */
export interface GateRuleConfig {
  /** Tool-name patterns; `*` matches any sequence. At least one pattern is required. */
  tool: string[]
  /** Predicate question asked about the pending call. */
  question: string
  /** Trigger when the predicate probability is at least this value (0 through 1). */
  threshold: number
  /** Decision returned when the threshold is met. Defaults to `ask`. */
  action?: GateAction
}

/** Optional pre-execute policy gate. Disabled by default. */
export interface GateConfig {
  enabled?: boolean
  model?: DecisionModel
  /** Tool-name patterns the gate never evaluates. Defaults to the plugin's own tool. */
  exclude?: string[]
  /** Maximum serialized tool-call input in UTF-8 bytes. */
  maxInputBytes?: number
  /** Gate-specific decision deadline in milliseconds. */
  requestTimeoutMs?: number
  /** Decision when the gate cannot evaluate a call. Defaults to `deny`. */
  onError?: GateErrorAction
  rules?: GateRuleConfig[]
}

/** Plugin configuration. */
export interface Config {
  apiKeyEnv?: string
  model?: DecisionModel
  maxInputBytes?: number
  maxQuestions?: number
  maxChoices?: number
  maxScoreLevels?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  requestTimeoutMs?: number
  gate?: GateConfig
}

/** One validated gate rule. */
export interface ResolvedGateRule {
  readonly tool: readonly string[]
  readonly question: string
  readonly threshold: number
  readonly action: GateAction
}

/** Validated gate configuration with every default applied. */
export interface ResolvedGateConfig {
  readonly enabled: boolean
  readonly model: DecisionModel
  readonly exclude: readonly string[]
  readonly maxInputBytes: number
  readonly requestTimeoutMs: number
  readonly onError: GateErrorAction
  readonly rules: readonly ResolvedGateRule[]
}

/** Validated configuration the plugin is built from. */
export interface ResolvedConfig {
  readonly apiKeyEnv: string
  readonly model: DecisionModel
  readonly maxInputBytes: number
  readonly maxQuestions: number
  readonly maxChoices: number
  readonly maxScoreLevels: number
  readonly maxRequestBytes: number
  readonly maxResponseBytes: number
  readonly requestTimeoutMs: number
  readonly gate: ResolvedGateConfig
}

/** Maximum gate rules; the provider accepts 64 questions per request. */
const MAX_GATE_RULES = 64

/** Documented provider limits; configuration may lower them, never raise them. */
const PROVIDER_MAX_QUESTIONS = 64
const PROVIDER_MAX_CHOICES = 26

const gateRuleSchema = z.object({
  tool: z.array(z.string()).required().description('Tool-name patterns; * matches any sequence.'),
  question: z.string().required().description('Predicate question asked about the pending call.'),
  threshold: z.number().required().description('Trigger when the probability is at least this value (0 through 1).'),
  action: z.union(GATE_ACTIONS).default('ask').description('Decision returned when the threshold is met.'),
})

const gateSchema = z.object({
  enabled: z.boolean().default(false).description('Enable the pre-execute decision gate.'),
  model: z.union(DECISION_MODELS).default('decision-small').description('Decision model used by the gate.'),
  exclude: z.array(z.string()).default(['decisions']).description('Tool-name patterns the gate never evaluates.'),
  maxInputBytes: z.number().default(8192).description('Maximum serialized tool-call input in UTF-8 bytes.'),
  requestTimeoutMs: z.number().default(15000).description('Gate decision deadline in milliseconds.'),
  onError: z.union(GATE_ERROR_ACTIONS).default('deny').description('Decision when the gate cannot evaluate a call.'),
  rules: z.array(gateRuleSchema).description('Predicate rules; every matching rule contributes one question.'),
}) as unknown as z<GateConfig>

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).description('Environment variable holding the Tinfoil API key.'),
  model: z.union(DECISION_MODELS).default('decision-medium').description('Decision model for the decisions tool.'),
  maxInputBytes: z.number().default(65536).description('Maximum decision input in UTF-8 bytes.'),
  maxQuestions: z.number().default(64).description('Maximum questions per decision request.'),
  maxChoices: z.number().default(26).description('Maximum choices per choice question.'),
  maxScoreLevels: z.number().default(26).description('Maximum ordered levels per score question.'),
  maxRequestBytes: z.number().default(1048576).description('Maximum serialized request body in bytes.'),
  maxResponseBytes: z.number().default(1048576).description('Maximum provider response body in bytes.'),
  requestTimeoutMs: z.number().default(120000).description('Decision deadline in milliseconds, including attestation.'),
  gate: gateSchema.description('Optional pre-execute predicate gate.'),
}) as z<Config>

function modelOf(value: string): DecisionModel {
  if (!(DECISION_MODELS as readonly string[]).includes(value)) {
    throw new Error(`tinfoil-decisions: model must be one of ${DECISION_MODELS.join(', ')}`)
  }
  return value as DecisionModel
}

function gateActionOf(value: string): GateAction {
  if (!(GATE_ACTIONS as readonly string[]).includes(value)) {
    throw new Error(`tinfoil-decisions: gate action must be one of ${GATE_ACTIONS.join(', ')}`)
  }
  return value as GateAction
}

function gateErrorActionOf(value: string): GateErrorAction {
  if (!(GATE_ERROR_ACTIONS as readonly string[]).includes(value)) {
    throw new Error(`tinfoil-decisions: gate.onError must be one of ${GATE_ERROR_ACTIONS.join(', ')}`)
  }
  return value as GateErrorAction
}

function resolvePatterns(values: readonly string[], name: string): readonly string[] {
  if (values.length === 0) return []
  return values.map((value, index) => {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`tinfoil-decisions: ${name}[${index}] must not be empty`)
    }
    return trimmed
  })
}

function resolveGateRule(rule: GateRuleConfig, index: number): ResolvedGateRule {
  const tool = resolvePatterns(rule.tool, `gate.rules[${index}].tool`)
  if (tool.length === 0) {
    throw new Error(`tinfoil-decisions: gate.rules[${index}].tool must contain at least one pattern`)
  }
  if (tool.every(pattern => pattern === RUN_CODE_NAME)) {
    throw new Error(
      `tinfoil-decisions: gate.rules[${index}].tool targets only ${RUN_CODE_NAME}, which the gate skips; add a tool pattern the gate can evaluate or remove the rule`,
    )
  }
  const question = rule.question.trim()
  if (question.length === 0) {
    throw new Error(`tinfoil-decisions: gate.rules[${index}].question must not be empty`)
  }
  if (!Number.isFinite(rule.threshold) || rule.threshold < 0 || rule.threshold > 1) {
    throw new Error(`tinfoil-decisions: gate.rules[${index}].threshold must be between 0 and 1`)
  }
  return {
    tool,
    question,
    threshold: rule.threshold,
    action: gateActionOf(rule.action ?? 'ask'),
  }
}

function resolveGate(
  gate: GateConfig | undefined,
  limits: { maxQuestions: number; maxInputBytes: number },
): ResolvedGateConfig {
  const raw = gate ?? {}
  const rules = (raw.rules ?? []).map((rule, index) => resolveGateRule(rule, index))
  if (rules.length > MAX_GATE_RULES) {
    throw new Error(`tinfoil-decisions: gate.rules must contain at most ${MAX_GATE_RULES} entries`)
  }
  if (rules.length > limits.maxQuestions) {
    throw new Error(
      `tinfoil-decisions: gate.rules must contain at most maxQuestions (${limits.maxQuestions}) entries`,
    )
  }
  const enabled = raw.enabled ?? false
  if (enabled && rules.length === 0) {
    throw new Error('tinfoil-decisions: gate.enabled requires at least one gate rule')
  }
  const maxInputBytes = positiveInteger(raw.maxInputBytes ?? 8192, 'tinfoil-decisions: gate.maxInputBytes')
  if (maxInputBytes > limits.maxInputBytes) {
    throw new Error(
      `tinfoil-decisions: gate.maxInputBytes must not exceed maxInputBytes (${limits.maxInputBytes})`,
    )
  }
  return {
    enabled,
    model: modelOf(raw.model ?? 'decision-small'),
    exclude: resolvePatterns(raw.exclude ?? ['decisions'], 'gate.exclude'),
    maxInputBytes,
    requestTimeoutMs: positiveInteger(raw.requestTimeoutMs ?? 15000, 'tinfoil-decisions: gate.requestTimeoutMs'),
    onError: gateErrorActionOf(raw.onError ?? 'deny'),
    rules,
  }
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const maxQuestions = positiveInteger(config.maxQuestions ?? 64, 'tinfoil-decisions: maxQuestions')
  if (maxQuestions > PROVIDER_MAX_QUESTIONS) {
    throw new Error(`tinfoil-decisions: maxQuestions must not exceed ${PROVIDER_MAX_QUESTIONS}`)
  }
  const maxChoices = positiveInteger(config.maxChoices ?? 26, 'tinfoil-decisions: maxChoices')
  if (maxChoices > PROVIDER_MAX_CHOICES) {
    throw new Error(`tinfoil-decisions: maxChoices must not exceed ${PROVIDER_MAX_CHOICES}`)
  }
  const maxInputBytes = positiveInteger(config.maxInputBytes ?? 65536, 'tinfoil-decisions: maxInputBytes')
  return {
    apiKeyEnv: resolveApiKeyEnv(config.apiKeyEnv, 'tinfoil-decisions: apiKeyEnv'),
    model: modelOf(config.model ?? 'decision-medium'),
    maxInputBytes,
    maxQuestions,
    maxChoices,
    maxScoreLevels: positiveInteger(config.maxScoreLevels ?? 26, 'tinfoil-decisions: maxScoreLevels'),
    maxRequestBytes: positiveInteger(config.maxRequestBytes ?? 1048576, 'tinfoil-decisions: maxRequestBytes'),
    maxResponseBytes: positiveInteger(config.maxResponseBytes ?? 1048576, 'tinfoil-decisions: maxResponseBytes'),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs ?? 120000, 'tinfoil-decisions: requestTimeoutMs'),
    gate: resolveGate(config.gate, { maxQuestions, maxInputBytes }),
  }
}
