# Architecture

This repository ships one private shared source package, seven capability plugins, and a root
meta-bundle for DeepSeek Harness (DSH). The goal is independent plugins with one place for protocol
plumbing.

## Package map

| Package | Role |
| --- | --- |
| `@srmico/dsh-tinfoil` | Root meta-bundle: inserts all seven plugin rows and pins the base `web` row to Tinfoil. |
| `@srmico/dsh-tinfoil-lib` | Private unpublished source. Owns the Tinfoil SDK transport, attestation contract, bounded HTTP helpers, config validation, endpoint constants, and cross-plugin capability types. Bundled into each plugin's `lib/index.js` and `lib/index.d.ts` by tsdown at build time. Not a plugin and not a bundle. |
| `@srmico/dsh-tinfoil-documents` | Document conversion tools and cache. |
| `@srmico/dsh-tinfoil-pii` | Privacy-filter tools. |
| `@srmico/dsh-tinfoil-decisions` | Typed-decision tool and optional pre-execute gate. |
| `@srmico/dsh-tinfoil-audio` | Transcription and speech tools. |
| `@srmico/dsh-tinfoil-web` | Search and fetch providers on `ctx.web`. |
| `@srmico/dsh-tinfoil-provider` | Tinfoil route on `ctx.llm` and native web search. |
| `@srmico/dsh-tinfoil-verification` | Attestation registry, authenticated routes, Settings page, and composer lock. |

## Installation model

The root bundle is the one-command all-in-one install. Every capability plugin is also a dual-role
plugin + bundle, so it can be installed alone:

```sh
dsh plugin add @srmico/dsh-tinfoil
# or one capability:
dsh plugin add @srmico/dsh-tinfoil-pii
```

The web plugin's own patch also pins the base `web` row to `tinfoil`. The other plugin patches insert
only their row.

Install the root bundle **or** individual plugin bundles, not both. If both are selected, the same
row id is declared twice; DSH keeps one live entry (the last bundle layer wins) and the Plugins UI
marks the row unaddressable. This is upstream behavior.

`@srmico/dsh-tinfoil-lib` has no `dsh.bundle` and is `private`; it is not published and users never
install it. The root build compiles it first, then each plugin build runs tsdown, which bundles the
plugin entry and its declarations while inlining the private library. The published tarballs
therefore have no dependency on a separately published Tinfoil library package.

## Bundling

The plugins follow the DSH package pattern: `tsc` is the type checker and `tsdown` (Rolldown) is the
publisher of `lib/index.js` and `lib/index.d.ts`. Each plugin has a `tsdown.config.ts` with:

- `entry` for `src/index.ts` (verification adds `src/registry.ts`);
- `dts: true` with the TypeScript resolver so declarations are bundled too;
- `deps.neverBundle: true` with `deps.alwaysBundle` and `deps.dts.alwaysBundle` limited to
  `@srmico/dsh-tinfoil-lib`, which externalizes every other package and inlines only the private
  library.

All other imports stay external because they are declared production or peer dependencies. The
library is a `workspace:*` devDependency of each plugin, so it is available at build time but is never
installed by end users.

Duplicating the library per plugin is safe: the cross-plugin contracts are ordinary Cordis service
names (`tinfoilAttestation`, `tinfoilNativeWebSearch`) and structural TypeScript types, not shared
JavaScript singletons. Error classes are also per package; no plugin performs an `instanceof` check
against another package's error type. The plugins and the root bundle still release in lockstep so
their protocol expectations stay aligned.

The bundled code keeps its external imports: `tinfoil` for the SDK transport and
`@deepseek-ai/dsh-llm` for `HarnessError`. Each plugin therefore declares `tinfoil` as a production
dependency and the DSH packages as peers; no plugin depends on the private library at runtime.

## DSH seams

| Seam | Used by |
| --- | --- |
| `ctx.tools` | documents, PII, decisions, audio |
| `ctx.fs` / `ctx.workingDirectory` | documents, PII file flow, audio file flow |
| `ctx.attachments` | document page images, speech output |
| `ctx.web` | web search/fetch providers |
| `ctx.llm` | Tinfoil model provider |
| `ctx.connection` + client modules | verification routes and browser UI |

Plugins inject only what they need. A plugin whose seam is absent waits; for example the web plugin
does nothing in a composition without `ctx.web`.

## Attestation modes

- `sdk` — Tinfoil `SecureClient` verifies the enclave and encrypts the request before any data is
  sent. Documents, PII, decisions, audio, web, and the provider use this mode by default.
- `proxy` — the local `tinfoil-proxy` performs attestation. The verification page labels it
  “Attested by proxy” and offers no host-side document.
- `endpoint` — an explicit unattested operator endpoint (documents self-hosted service, Exa/local
  MCP, or the web plugin's MCP endpoint). Nothing is verified.
- `direct` — the provider's explicit unattested inference mode.

Each capability plugin publishes a target through `ctx.tinfoilAttestation` when the verification
plugin is mounted. The registry returns snapshot version 2 with the canonical known-target list and
each loaded target's state. The browser renders “Not loaded” for known targets that are absent.
Only `sdk` targets declare `verify`; the verification page runs the same `SecureClient` the plugin
uses. The browser store refreshes status every 10 seconds, verifies every verifiable target at
startup and every 5 minutes, exposes **Verify all**, and keeps **Check status** as a read-only
refresh.

## Cross-plugin contracts

- `ctx.tinfoilAttestation` — the registry contract is defined in the shared source and bundled into
  the capability packages; the verification package implements it. Capability packages only depend on
  the bundled contract, not on the verification package.
- `ctx.tinfoilNativeWebSearch` — the provider advertises native search while it is enabled; the web
  plugin reads it and hides DSH's `web_search`/`web_fetch` for that model route to avoid double
  billing.

## Documents cache

The conversion cache is content-addressed but not by bytes alone. The key hashes:

1. the converter identity (`sdk:<router config repo>` or `endpoint:<normalized URL>`),
2. the source extension and media type,
3. the source bytes.

Manifest version 2 records the identity and whether the producing client was security-verified.
Changing between attested and self-hosted mode, or between endpoint URLs, produces a different key.
Entries from the retired single-key cache are removed when the cache is reconciled. The cache stores
text and page PNGs with `0600` files under a `0700` root, validates relative page paths, rejects
symlinked page files, caps reads against the manifest, and checks the total size before writing.

## Configuration rules

- The API key is always read from an environment variable named by `apiKeyEnv`; never store a key
  literal in a profile.
- Plain HTTP is accepted only for literal loopback hosts. `allowInsecureHttp: true` is an explicit
  opt-in for trusted private networks and applies to documents, web, and provider endpoints.
- `endpoint`/`baseURL` are absolute HTTP(S) URLs without credentials, query, or fragment.
- Timeouts cover attestation plus the request. `maxResponseBytes`, input caps, and page caps are
  enforced before content reaches the model.

## Naming conventions

- Packages: `@srmico/dsh-tinfoil-*`; the internal shared source ends in `-lib` and is not published.
- Loader row ids: `tinfoil-*`, matching the package suffix.
- Tool names: lower_snake_case.
- Services: lowerCamelCase (`tinfoilAttestation`, `tinfoilNativeWebSearch`).
- Attestation target ids: short capability names (`documents`, `pii`, `web`, `provider`, …).
