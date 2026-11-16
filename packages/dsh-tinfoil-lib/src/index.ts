export {
  TinfoilError,
} from './errors.js'
export type {
  TinfoilErrorFactory,
  TinfoilTransportErrorCode,
} from './errors.js'

export {
  DEFAULT_API_KEY_ENV,
  MAX_TIMER_DELAY_MS,
  isLoopbackHost,
  nonEmptyString,
  positiveInteger,
  resolveApiKeyEnv,
  resolveHttpUrl,
} from './config.js'
export type { HttpUrlOptions } from './config.js'

export {
  classifyHttpStatus,
  errorDetail,
  isAbortError,
  raceWithSignal,
  readBytesCapped,
  readProviderErrorBody,
  readTextCapped,
  readTextPrefix,
  responseTooLarge,
  sanitizeDetail,
} from './http.js'
export type {
  ProviderErrorBody,
  ProviderErrorBodyOptions,
  ResponseLimitOptions,
  TinfoilHttpFailure,
} from './http.js'

export {
  TinfoilEndpointClient,
  TinfoilSecureClient,
} from './secure-client.js'
export type {
  TinfoilAttestedEndpoint,
  TinfoilEndpointClientOptions,
  TinfoilSecureClientOptions,
} from './secure-client.js'

export {
  TINFOIL_KNOWN_TARGETS,
  TinfoilAttestationError,
  registerTinfoilAttestation,
} from './attestation.js'
export type {
  TinfoilAttestationEntry,
  TinfoilAttestationMode,
  TinfoilAttestationRegistry,
  TinfoilAttestationSnapshot,
  TinfoilAttestationState,
  TinfoilAttestationTarget,
  TinfoilKnownTarget,
} from './attestation.js'

export {
  TINFOIL_MCP_PATH,
  TINFOIL_PII_CONFIG_REPO,
  TINFOIL_PII_ORIGIN,
  TINFOIL_ROUTER_CONFIG_REPO,
  TINFOIL_ROUTER_ORIGIN,
  TINFOIL_WEBSEARCH_CONFIG_REPO,
  TINFOIL_WEBSEARCH_ORIGIN,
} from './endpoints.js'

export {
  TINFOIL_NATIVE_WEB_SEARCH,
} from './capabilities.js'
export type { TinfoilNativeWebSearchService } from './capabilities.js'

export type { VerificationDocument } from 'tinfoil'
