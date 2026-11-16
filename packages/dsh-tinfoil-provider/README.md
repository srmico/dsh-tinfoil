# @srmico/dsh-tinfoil-provider

Registers Tinfoil as a model provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
It adds the `tinfoil` route on `ctx.llm`, a shipped six-model chat catalog, and native web search.

## Installation

```sh
# All Tinfoil capabilities:
dsh plugin add @srmico/dsh-tinfoil

# Provider alone:
dsh plugin add @srmico/dsh-tinfoil-provider
```

The package is a plugin and a bundle, so a standalone install activates its row. Do not install the
root bundle and this package together; the duplicate row id becomes unaddressable in the Plugins UI.

## Modes

| Mode | Endpoint | Attestation | Proxy |
| --- | --- | --- | --- |
| `sdk` (default) | Tinfoil attested router via `SecureClient` | SDK attestation | No |
| `proxy` | `http://127.0.0.1:3301/v1` by default | Performed by `tinfoil-proxy` | Yes |
| `direct` | `https://inference.tinfoil.sh/v1` | None; explicit opt-out | No |

`sdk` verifies the enclave and encrypts request bodies before inference. `proxy` trusts the local
attested proxy and sends ordinary HTTP over loopback. `direct` sends plain HTTPS without attestation;
do not use it for private data.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0` with `ctx.llm`; Node `^24.22.1 || >=26.12.1`.
- The DSH installation's `@deepseek-ai/dsh-llm-pi-ai` and `@earendil-works/pi-ai` packages. The plugin
  imports the exported adapter and does not mount the `llm-pi-ai` row.
- `TINFOIL_API_KEY` in the launch environment or `$DSH_HOME/.env`.
- Optional Docker Compose for the local attested proxy.

## Configuration

```yaml
- id: tinfoil-provider
  config:
    mode: sdk
    apiKeyEnv: TINFOIL_API_KEY
```

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | `tinfoil` | Route id. Change it to avoid an adapter collision. |
| `displayName` | `Tinfoil` | Label shown by selectors. |
| `apiKeyEnv` | `TINFOIL_API_KEY` | Environment variable name; never a key literal. |
| `mode` | `sdk` | `sdk`, `proxy`, or `direct`. |
| `baseURL` | mode-dependent | Absolute HTTP(S) URL without credentials/query/fragment. Keep `/v1` in sdk mode. |
| `allowInsecureHttp` | `false` | Allow plain HTTP to a non-loopback `baseURL`. |
| `api` | `openai-responses` | Default protocol for new model entries. |
| `models` | shipped catalog | Model entries merged by id. |
| `compat` | protocol defaults | Route-level wire-compatibility switches. |
| `headers` | none | Additional request headers; reserved names are rejected. |
| `timeoutMs` | `600000` | Provider request timeout, including attestation. |
| `streamIdleTimeoutMs` | `300000` | Maximum stream-read idle time. |
| `retryPolicy` | normal | Provider-owned retry policy. |
| `webSearch` | enabled | `{ enabled, piiCheck, injectionCheck }` for native web search. |

Model entries accept `id`, `name`, `api`, `contextWindow`, `maxTokens`, `input`, `reasoningEfforts`,
and `compat`. A shipped id keeps unset fields; a new id appends with conservative defaults.

## Shipped catalog

| id | protocol | context | max output | input |
| --- | --- | --- | --- | --- |
| `deepseek-v4-1-flash` | Responses | 1,048,576 | 262,144 | text, image |
| `glm-5-3` | Responses | 1,048,576 | 131,072 | text |
| `kimi-k3-1-pro` | Responses | 262,144 | 65,536 | text, image |
| `gemma4-31b` | Responses | 262,144 | 32,768 | text, image |
| `gpt-oss-120b` | Responses | 131,072 | 32,768 | text |
| `llama3-3-70b` | Chat Completions | 131,072 | 4,096 | text |

The catalog is a static snapshot; runtime discovery is on the roadmap. `maxTokens` is the adapter's
default request cap and can be overridden per model.

## Native web search

Enabled by default. The provider injects Tinfoil's native search into Responses and Chat Completions
requests and advertises `tinfoilNativeWebSearch` so the web plugin hides DSH's MCP web tools for that
route. Tinfoil bills one web-search fee per model request when search is used.

```yaml
- id: tinfoil-provider
  config:
    webSearch:
      enabled: false
      piiCheck: true
      injectionCheck: true
```

Disable it to use DSH's `web_search`/`web_fetch` tools. Native results are not replayed into later DSH
requests, so MCP tools remain preferable for agent loops and structured cards.

## Model selection

The provider does not change `agent-default-model`. In headless/Web, select `tinfoil` and a model in
the picker or set the row explicitly. `dsh-sdk-minimal` takes `provider`/`model` from the SDK client's
initialize handshake. The provider does not hijack `deepseek-official`.

## Security

- `sdk` verifies before sending and encrypts request bodies; there is no unverified fallback.
- `proxy` trusts the local proxy; keep it on loopback or a trusted private network.
- `direct` is explicitly unattested.
- The key is read from `apiKeyEnv` per request, travels only in `Authorization`, and is never logged.
- Provider error bodies are not added to model-visible errors.
- The Tinfoil SDK may persist a prompt-cache scoping secret at `~/.tinfoil/user_cache_secret`; it is
  not an API key. Shared multi-user hosts should set `TINFOIL_USER_CACHE_SECRET` per end user.

## Limitations

- Static catalog; no runtime discovery or Models-page editing.
- Model removal requires a plugin update; configuration can add or correct entries.
- `direct`/`proxy` modes have no host-side verification document.
- No automated tests yet.

## Development

Build and typecheck from the repository root; see
[Development](https://github.com/srmico/dsh-tinfoil/blob/main/docs/DEVELOPMENT.md). The source-only
`proxy/` Compose stack is excluded from the published package.

## License

MIT.
