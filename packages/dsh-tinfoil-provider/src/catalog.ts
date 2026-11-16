import type {
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
  ThinkingLevelMap,
} from '@earendil-works/pi-ai'

/** Wire protocol this provider can dispatch. */
export type Protocol = 'openai-responses' | 'openai-completions'

/** Request modality a Tinfoil chat model accepts. */
export type InputModality = 'text' | 'image'

/** pi-ai thinking levels, in escalation order. */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Every thinking level, in pi-ai's canonical order. */
const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/**
 * Declared reasoning levels by pi-ai level. A declared level's string is the
 * wire spelling; `null` is legal only for `off` and means "send nothing";
 * undeclared levels are unsupported. `false` declares a non-reasoning model.
 */
export type ReasoningEfforts = false | Partial<Record<ThinkingLevel, string | null>>

/**
 * Wire-compatibility switches this provider exposes. Route-level switches
 * apply to every model whose protocol accepts them; a model-level switch its
 * protocol does not accept is rejected. Other pi-ai compat fields remain at
 * pi-ai's own defaults.
 */
export interface Compat {
  supportsDeveloperRole?: boolean
  supportsStore?: boolean
  supportsReasoningEffort?: boolean
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  supportsUsageInStreaming?: boolean
  supportsMaxOutputTokens?: boolean
}

/** One model entry accepted from plugin configuration. */
export interface ModelProfile {
  id: string
  name?: string
  api?: Protocol
  contextWindow?: number
  maxTokens?: number
  input?: InputModality[]
  reasoningEfforts?: ReasoningEfforts
  compat?: Compat
}

/** One fully materialized model ready for pi-ai. */
export interface ResolvedModel {
  id: string
  name: string
  api: Protocol
  contextWindow: number
  maxTokens: number
  input: readonly InputModality[]
  reasoning: boolean
  thinkingLevelMap?: ThinkingLevelMap
  compat: ResolvedCompat
}

/** A resolved compat block, protocol-filtered and structurally pi-ai compatible. */
export type ResolvedCompat = OpenAICompletionsCompat & OpenAIResponsesCompat

/** Full seed metadata for the shipped catalog. */
interface CatalogSeed {
  id: string
  name: string
  api: Protocol
  contextWindow: number
  maxTokens: number
  input: readonly InputModality[]
  reasoningEfforts: ReasoningEfforts
  compat?: Compat
}

const DEFAULT_CONTEXT_WINDOW = 1_000_000
const DEFAULT_MAX_TOKENS = 128_000
const DEFAULT_INPUT: readonly InputModality[] = ['text']

/**
 * Tinfoil's chat catalog as of 2026-11, from
 * `GET https://inference.tinfoil.sh/v1/models` with model metadata from
 * models.dev. `kimi-k3-1-pro` is marked experimental upstream.
 *
 * `maxTokens` is conservative where sources differ. It is the adapter's
 * default request cap, so raising it is a config decision, not a plugin one.
 */
const DEFAULT_CATALOG: readonly CatalogSeed[] = [
  {
    id: 'deepseek-v4-1-flash',
    name: 'DeepSeek V4.1 Flash',
    api: 'openai-responses',
    contextWindow: 1_048_576,
    maxTokens: 262_144,
    input: ['text', 'image'],
    reasoningEfforts: { off: 'none', low: 'low', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
  {
    id: 'glm-5-3',
    name: 'GLM-5.3',
    api: 'openai-responses',
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    input: ['text'],
    reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
  },
  {
    id: 'kimi-k3-1-pro',
    name: 'Kimi K3.1 Pro',
    api: 'openai-responses',
    contextWindow: 262_144,
    maxTokens: 65_536,
    input: ['text', 'image'],
    reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
  },
  {
    id: 'gemma4-31b',
    name: 'Gemma 4 31B',
    api: 'openai-responses',
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ['text', 'image'],
    reasoningEfforts: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
  },
  {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS 120B',
    api: 'openai-responses',
    contextWindow: 131_072,
    maxTokens: 32_768,
    input: ['text'],
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'llama3-3-70b',
    name: 'Llama 3.3 70B',
    api: 'openai-completions',
    contextWindow: 131_072,
    maxTokens: 4_096,
    input: ['text'],
    reasoningEfforts: false,
  },
]

/** Fields each protocol accepts from {@link Compat}. */
const COMPAT_FIELDS: Readonly<Record<keyof Compat, readonly Protocol[]>> = {
  supportsDeveloperRole: ['openai-responses', 'openai-completions'],
  supportsStore: ['openai-completions'],
  supportsReasoningEffort: ['openai-completions'],
  maxTokensField: ['openai-completions'],
  supportsUsageInStreaming: ['openai-completions'],
  supportsMaxOutputTokens: ['openai-responses'],
}

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS)

/**
 * Materialize the shipped catalog merged with configured entries by id.
 * Existing ids keep unset seed fields; new ids append with conservative
 * defaults. Configuration order does not reorder the shipped catalog.
 * @param profiles - configured model entries, when any.
 * @param routeApi - protocol for entries that name none.
 * @param routeCompat - route-level compat defaults.
 * @returns the resolved catalog in catalog order.
 */
export function materializeModels(
  profiles: readonly ModelProfile[] | undefined,
  routeApi: Protocol,
  routeCompat: Compat | undefined,
): readonly ResolvedModel[] {
  const seeds = new Map<string, CatalogSeed>()
  const order: string[] = []
  for (const seed of DEFAULT_CATALOG) {
    seeds.set(seed.id, seed)
    order.push(seed.id)
  }

  const seen = new Set<string>()
  for (const entry of profiles ?? []) {
    const id = entry.id.trim()
    if (id.length === 0) throw new Error('tinfoil-provider: model ids must not be empty')
    if (seen.has(id)) throw new Error(`tinfoil-provider: model "${id}" is listed more than once`)
    seen.add(id)
    const seed = seeds.get(id)
    if (seed === undefined) order.push(id)
    seeds.set(id, mergeEntry(id, seed, entry, routeApi))
  }

  return order.map(id => resolveEntry(seeds.get(id) as CatalogSeed, routeCompat))
}

/** Merge one configured entry over its shipped seed, or over defaults for a new id. */
function mergeEntry(
  id: string,
  seed: CatalogSeed | undefined,
  entry: ModelProfile,
  routeApi: Protocol,
): CatalogSeed {
  const name = nonEmptyName(entry.name ?? seed?.name ?? id, id)
  // A shipped model keeps its protocol; the route default is for new ids.
  const api = entry.api ?? seed?.api ?? routeApi
  const contextWindow = positiveInteger(
    entry.contextWindow ?? seed?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    `model "${id}" contextWindow`,
  )
  const maxTokens = positiveInteger(
    entry.maxTokens ?? seed?.maxTokens ?? DEFAULT_MAX_TOKENS,
    `model "${id}" maxTokens`,
  )
  const input = entry.input !== undefined && entry.input.length > 0
    ? [...entry.input]
    : seed?.input ?? DEFAULT_INPUT
  for (const modality of input) {
    if (modality !== 'text' && modality !== 'image') {
      throw new Error(`tinfoil-provider: model "${id}" input contains unsupported modality "${String(modality)}"`)
    }
  }
  if ((entry.reasoningEfforts as unknown) === null) {
    throw new Error(
      `tinfoil-provider: model "${id}" reasoningEfforts must be a dict or false; a valueless key is not supported`,
    )
  }
  const compat = mergeCompat(seed?.compat, entry.compat)
  return {
    id,
    name,
    api,
    contextWindow,
    maxTokens,
    input,
    reasoningEfforts: mergeReasoning(entry.reasoningEfforts, seed?.reasoningEfforts),
    ...compat === undefined ? {} : { compat },
  }
}

/** Keep the seed's declared levels when an entry declares none. */
function mergeReasoning(
  configured: ReasoningEfforts | undefined,
  seed: ReasoningEfforts | undefined,
): ReasoningEfforts {
  if (configured === false) return false
  if (configured !== undefined && Object.keys(configured).length > 0) return { ...configured }
  return seed ?? false
}

/** Combine seed and entry switches; entry fields win. */
function mergeCompat(seed: Compat | undefined, entry: Compat | undefined): Compat | undefined {
  if (seed === undefined) return entry === undefined ? undefined : { ...entry }
  if (entry === undefined) return { ...seed }
  return { ...seed, ...entry }
}

/** Resolve one seed into the shape pi-ai consumes. */
function resolveEntry(seed: CatalogSeed, routeCompat: Compat | undefined): ResolvedModel {
  const reasoning = resolveReasoning(seed.id, seed.reasoningEfforts)
  const compat = resolveCompat(seed.id, seed.api, reasoning.reasoning, routeCompat, seed.compat)
  return {
    id: seed.id,
    name: seed.name,
    api: seed.api,
    contextWindow: seed.contextWindow,
    maxTokens: seed.maxTokens,
    input: seed.input,
    reasoning: reasoning.reasoning,
    ...reasoning.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: reasoning.thinkingLevelMap },
    compat,
  }
}

/** Translate declared efforts into pi-ai's explicit thinking-level map. */
function resolveReasoning(
  id: string,
  efforts: ReasoningEfforts,
): { reasoning: boolean; thinkingLevelMap?: ThinkingLevelMap } {
  if (efforts === false) return { reasoning: false }
  const declared = Object.keys(efforts)
  if (declared.length === 0) {
    throw new Error(`tinfoil-provider: model "${id}" has an empty reasoningEfforts; declare levels or set false`)
  }
  for (const level of declared) {
    if (!THINKING_LEVEL_SET.has(level)) {
      throw new Error(`tinfoil-provider: model "${id}" reasoningEfforts names unknown level "${level}"`)
    }
  }

  const map: ThinkingLevelMap = {}
  let offersThinking = false
  for (const level of THINKING_LEVELS) {
    const value = efforts[level]
    if (value === undefined) {
      map[level] = null
      continue
    }
    if (value === null) {
      if (level !== 'off') {
        throw new Error(`tinfoil-provider: model "${id}" reasoningEfforts.${level} needs a wire value`)
      }
      continue
    }
    if (value.length === 0) {
      throw new Error(`tinfoil-provider: model "${id}" reasoningEfforts.${level} must not be empty`)
    }
    map[level] = value
    if (level !== 'off') offersThinking = true
  }
  if (!offersThinking) {
    throw new Error(`tinfoil-provider: model "${id}" reasoningEfforts offers no level beyond "off"`)
  }
  return { reasoning: true, thinkingLevelMap: map }
}

/** Merge protocol defaults, route switches, and model switches. */
function resolveCompat(
  id: string,
  api: Protocol,
  reasoning: boolean,
  route: Compat | undefined,
  model: Compat | undefined,
): ResolvedCompat {
  const compat: ResolvedCompat = api === 'openai-responses'
    ? { supportsDeveloperRole: false }
    : {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      supportsReasoningEffort: reasoning,
    }

  applyCompat(compat, route, api, 'route', false)
  applyCompat(compat, model, api, `model "${id}"`, true)
  return compat
}

/** Apply one compat block, filtering route defaults and rejecting invalid model switches. */
function applyCompat(
  target: ResolvedCompat,
  source: Compat | undefined,
  api: Protocol,
  site: string,
  strict: boolean,
): void {
  if (source === undefined) return
  const record = target as unknown as Record<string, unknown>
  for (const [field, value] of Object.entries(source)) {
    if (value === undefined) continue
    const protocols = COMPAT_FIELDS[field as keyof Compat]
    if (protocols === undefined) {
      throw new Error(`tinfoil-provider: ${site} sets unknown compat "${field}"`)
    }
    if (!protocols.includes(api)) {
      if (strict) {
        throw new Error(
          `tinfoil-provider: ${site} sets compat "${field}", which "${api}" does not accept`,
        )
      }
      continue
    }
    record[field] = value
  }
}

function nonEmptyName(value: string, id: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`tinfoil-provider: model "${id}" name must not be empty`)
  return trimmed
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tinfoil-provider: ${field} must be a positive integer`)
  }
  return value
}
