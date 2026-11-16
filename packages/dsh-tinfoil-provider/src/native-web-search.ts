import type { Api, Model, StreamOptions } from '@earendil-works/pi-ai'
import { TINFOIL_NATIVE_WEB_SEARCH } from '@srmico/dsh-tinfoil-lib'
import type { TinfoilNativeWebSearchService } from '@srmico/dsh-tinfoil-lib'
import type { ResolvedWebSearchConfig } from './config.js'

export { TINFOIL_NATIVE_WEB_SEARCH }
export type { TinfoilNativeWebSearchService }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalOptions(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = payload[key]
  return isRecord(existing) ? existing : {}
}

/**
 * Add Tinfoil's native web-search tool/options to one provider payload.
 *
 * This only touches OpenAI Responses and Chat Completions payloads. Any
 * existing payload is cloned; the original object is never mutated.
 * @param payload - the provider's request payload.
 * @param api - the model's wire API.
 * @param config - resolved native web-search settings.
 * @returns the possibly extended payload.
 */
export function injectNativeWebSearch(
  payload: unknown,
  api: string,
  config: ResolvedWebSearchConfig,
): unknown {
  if (!isRecord(payload)) return payload
  if (api === 'openai-responses') {
    const tools = Array.isArray(payload.tools) ? [...payload.tools] : []
    if (!tools.some(tool => isRecord(tool) && tool.type === 'web_search')) {
      tools.push({ type: 'web_search' })
    }
    return {
      ...payload,
      tools,
      ...config.piiCheck ? { pii_check_options: optionalOptions(payload, 'pii_check_options') } : {},
      ...config.injectionCheck
        ? { prompt_injection_check_options: optionalOptions(payload, 'prompt_injection_check_options') }
        : {},
    }
  }
  if (api === 'openai-completions') {
    return {
      ...payload,
      web_search_options: optionalOptions(payload, 'web_search_options'),
      ...config.piiCheck ? { pii_check_options: optionalOptions(payload, 'pii_check_options') } : {},
      ...config.injectionCheck
        ? { prompt_injection_check_options: optionalOptions(payload, 'prompt_injection_check_options') }
        : {},
    }
  }
  return payload
}

/**
 * Wrap stream options so every Tinfoil chat request carries the native
 * web-search tool. Existing `onPayload` hooks are composed, not replaced.
 * @param options - the adapter's stream options.
 * @param config - resolved native web-search settings.
 * @returns the original options when disabled, otherwise options with an injected payload hook.
 */
export function withWebSearch<T extends StreamOptions>(
  options: T | undefined,
  config: ResolvedWebSearchConfig,
): T | undefined {
  if (!config.enabled) return options
  const previous = options?.onPayload
  const onPayload = async (payload: unknown, model: Model<Api>): Promise<unknown> => {
    const base = previous === undefined ? payload : (await previous(payload, model)) ?? payload
    return injectNativeWebSearch(base, model.api, config)
  }
  return { ...(options ?? {}), onPayload } as T
}
