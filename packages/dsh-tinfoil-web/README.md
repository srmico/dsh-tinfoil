# @srmico/dsh-tinfoil-web

Tinfoil web search and fetch providers for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
The plugin registers providers on `ctx.web`; DSH's `tool-web` keeps owning the model-facing
`web_search` and `web_fetch` tools.

## Installation

```sh
# All Tinfoil capabilities:
dsh plugin add @srmico/dsh-tinfoil

# Web search/fetch alone:
dsh plugin add @srmico/dsh-tinfoil-web
```

The package is a plugin and a bundle. Its patch inserts its row and pins the base `web` row to
`searchProvider: tinfoil`/`fetchProvider: tinfoil`. A profile without `ctx.web` (for example a
default `sdk-minimal` composition) makes the plugin wait quietly. Do not install the root bundle and
this package together; the duplicate row id becomes unaddressable in the Plugins UI.

## Modes

**Attested (default).** Uses `SecureClient` against `https://websearch.tinfoil.sh` with the
`tinfoilsh/confidential-websearch` release. Search and fetch stay inside the verified enclave; PII and
prompt-injection headers default on.

**Endpoint (explicit unattested).** Point `endpoint` at Exa's hosted MCP, a local Exa MCP server, or a
local Tinfoil-compatible MCP server. The plugin detects `web_search_exa`/`web_fetch_exa` or
`search`/`fetch`. It sends no Tinfoil key and applies no Tinfoil filters.

## Configuration

```yaml
- id: tinfoil-web
  config:
    piiCheck: true
    injectionCheck: true
    batchFetch: true
    batchWindowMs: 250
```

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `TINFOIL_API_KEY` | Key for attested mode. |
| `endpoint` | unset | MCP endpoint for unattested mode. |
| `allowInsecureHttp` | `false` | Allow plain HTTP to a non-loopback endpoint. |
| `endpointApiKeyEnv` | unset | Optional env var sent as `x-api-key` to `endpoint`. |
| `requestTimeoutMs` | `60000` | Whole operation deadline, including attestation and batch window. |
| `maxResponseBytes` | `4194304` (4 MiB) | MCP response cap. |
| `maxPageChars` | `50000` | Per-page character cap. |
| `piiCheck` | `true` | Send `X-Tinfoil-Tool-PII-Check` in attested mode. |
| `injectionCheck` | `true` | Send `X-Tinfoil-Tool-Injection-Check` in attested mode. |
| `batchFetch` | `true` | Coalesce concurrent `web_fetch` calls. |
| `batchWindowMs` | `250` | Batch window; a lone fetch waits up to this long. |

## Batching

Concurrent `web_fetch` calls are coalesced into one multi-URL request with a 250 ms window and up to 20
URLs. Each caller keeps its own cancellation; aborted URLs are dropped before dispatch. A single
fetch waits up to the window. Set `batchFetch: false` or lower `batchWindowMs` for lower latency.

## Native provider search

For Tinfoil model steps, the provider's native web search is on by default and hides DSH's
`web_search`/`web_fetch` to avoid paying both the native fee and per-call MCP fees. Disable it in the
provider row (`webSearch.enabled: false`) to use these tools with Tinfoil models. Other model routes
keep the DSH tools.

## Security and limits

Attested mode verifies the enclave before a request and sends Tinfoil's PII/injection headers by
default. Endpoint mode is an explicit weaker privacy boundary: no Tinfoil key, no attestation, and no
Tinfoil filters. Search results clamp to 30; page text defaults to 50,000 characters; responses cap at
4 MiB; URLs over 2,048 characters, non-HTTP(S) schemes, and embedded credentials are rejected before
any request. Provider queries and pages are not cached or logged.

## Limitations

- The MCP fetch surface does not expose the upstream HTTP status; successful pages are reported as
  200.
- Endpoint mode supports the two default search/fetch tools only (no Exa OAuth or advanced search).
- The Web Settings → Web search card can repoint `searchProvider`/`fetchProvider`; save the profile
  patch again if that happens.
- No automated tests yet.

## Development

Build and typecheck from the repository root; see
[Development](https://github.com/srmico/dsh-tinfoil/blob/main/docs/DEVELOPMENT.md).

## License

MIT.
