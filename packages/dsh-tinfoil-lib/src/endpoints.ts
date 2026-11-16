/** Public Tinfoil router origin used by clients that rely on the SDK default. */
export const TINFOIL_ROUTER_ORIGIN = 'https://inference.tinfoil.sh'

/** Release repository verified by the SDK's default router client. */
export const TINFOIL_ROUTER_CONFIG_REPO = 'tinfoilsh/confidential-model-router'

/** Attested privacy-filter enclave. */
export const TINFOIL_PII_ORIGIN = 'https://pii-filter.tinfoil.sh'

/** Release repository verified for the privacy filter. */
export const TINFOIL_PII_CONFIG_REPO = 'tinfoilsh/confidential-pii-cpu'

/** Attested websearch enclave origin. */
export const TINFOIL_WEBSEARCH_ORIGIN = 'https://websearch.tinfoil.sh'

/** Release repository verified for websearch. */
export const TINFOIL_WEBSEARCH_CONFIG_REPO = 'tinfoilsh/confidential-websearch'

/** MCP endpoint path resolved from the attested websearch origin. */
export const TINFOIL_MCP_PATH = '/mcp'
