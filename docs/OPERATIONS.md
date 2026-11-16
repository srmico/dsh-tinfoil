# Operations

Install, upgrade, troubleshoot, and clean up the Tinfoil integration.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0`.
- Node `^24.22.1 || >=26.12.1`.
- `TINFOIL_API_KEY` in the launch environment or `$DSH_HOME/.env` for hosted conversion, redaction,
  decisions, transcription, speech, attested web search/fetch, and model requests. Documents
  `endpoint` mode and web `endpoint` mode do not use the Tinfoil key.
- A profile that mounts the seams the selected plugins need. `dsh-base`, headless, and the Web app
  cover the common set; `dsh-sdk-minimal` needs manual `web`/`tool-web` rows for the literal web
  tools.
- Optional Docker Compose or rootless Podman for the documents self-hosted stack or the provider's
  local attested proxy.

## Install

All-in-one:

```sh
dsh plugin add @srmico/dsh-tinfoil
```

One capability:

```sh
dsh plugin add @srmico/dsh-tinfoil-documents
dsh plugin add @srmico/dsh-tinfoil-pii
dsh plugin add @srmico/dsh-tinfoil-decisions
dsh plugin add @srmico/dsh-tinfoil-audio
dsh plugin add @srmico/dsh-tinfoil-web
dsh plugin add @srmico/dsh-tinfoil-provider
dsh plugin add @srmico/dsh-tinfoil-verification
```

The capability packages are dual-role plugin + bundles; each activates its own row. The web plugin
also pins the base `web` row to `tinfoil`. Install the root bundle **or** individual plugins, not
both: a duplicate row id leaves one live entry and makes that row unaddressable in the Plugins UI.

Each plugin package is self-contained: the shared source is bundled into its `lib/` output at build
time. There is no separately published `@srmico/dsh-tinfoil-lib` package and nothing extra to install.

## Release channels

Packages are released in lockstep. Stable versions publish under `latest`; prereleases publish under
`next`:

```sh
dsh plugin add @srmico/dsh-tinfoil@0.1.0
dsh plugin add @srmico/dsh-tinfoil@next
```

Each release also attaches the exact npm tarballs and `SHA256SUMS` to a GitHub Release. A tarball can
be installed directly:

```sh
dsh plugin add ./srmico-dsh-tinfoil-pii-0.1.0.tgz
```

The root tarball pins exact plugin versions, so installing it still needs npm access for the plugin
packages unless all plugin tarballs are installed as well.

## First-run check

```sh
dsh --profile <profile> --dump-config
dsh --profile <profile>
```

Confirm the expected `tinfoil-*` rows exist and the startup log has no plugin error. In a Web-backed
profile, open Settings → Tinfoil and check the composer lock. A fresh profile verifies every
SDK-attested plugin automatically at startup; the lock settles once those checks finish. If a check
failed, use **Verify all** to retry.

## Upgrade

1. `dsh plugin remove @srmico/dsh-tinfoil` (or each plugin package you installed).
2. `dsh plugin add @srmico/dsh-tinfoil@<new-version>` (or the individual packages).
3. Restart the process; without HMR, configuration changes need a restart.
4. Re-check `--dump-config` and the verification page.

The plugin packages are released in lockstep; keep the installed plugins and the root bundle on the
same version.

## Remove

```sh
dsh plugin remove @srmico/dsh-tinfoil
```

Removing the root bundle removes the rows it owns. The plugins' dependencies, the conversion cache,
and saved attachments are not deleted automatically; see cleanup below.

## Key rotation

1. Replace `TINFOIL_API_KEY` in the launch environment or `$DSH_HOME/.env`.
2. Restart the process so the provider, tools, and SDK clients read the new value.
3. Run **Verify all** on Settings → Tinfoil. A rotated key can re-attest on the next call even if the
   verification page still shows the previous document.
4. If a 401/403 persists, confirm the key is enabled for the specific service (documents, privacy
   filter, decisions, audio, websearch, or inference) and that the environment variable name matches
   `apiKeyEnv`.

The key is read per request and is never stored in profile configuration or logs. Proxy mode forwards
the client's `Authorization` header; the proxy does not store the key.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No Tinfoil models in a picker | `TINFOIL_API_KEY` is unset, or the provider row did not load. Check `--dump-config`. |
| `MISSING_CREDENTIAL` / `TINFOIL_API_KEY_MISSING` | The configured `apiKeyEnv` variable is unset or empty. |
| `DUPLICATE_ADAPTER` | Another adapter owns the route id. Remove a `tinfoil` route from `llm-pi-ai` or change `provider`. |
| Attestation error | Enclave verification failed; no request body was sent. Retry after checking network access to the Tinfoil attestation service. |
| `TINFOIL_AUTH_FAILED` | Key rejected, expired, or not enabled for that service. |
| `TINFOIL_QUOTA_EXCEEDED` / billing paused | The key's lifetime quota or billing state is exhausted; retrying does not help. Check the Tinfoil dashboard. |
| `TINFOIL_RATE_LIMITED` | Transient rate limit; retry later. |
| `TINFOIL_REDIRECT_REJECTED` or a redirect failure | A provider returned a redirect; the plugin fails closed instead of replaying a body. |
| `DOCUMENT_TOO_MANY_PAGES` | Raise `maxPages` or split the document. |
| `SCANNED_PAGES_UNSUPPORTED` | Scanned pages have no text in `images` mode; use `read_document_as_image` until OCR lands. |
| `CACHE_CORRUPTED` | The plugin invalidates and reconverts automatically. Persistent failure: delete the cache directory. |
| Web tools missing with a Tinfoil model | Native provider web search hides them by design; set `webSearch.enabled: false` to use DSH's tools. |
| Web tools missing in `sdk-minimal` | Add the manual `web`/`tool-web` rows. The plugin waits without a seam. |
| Verification page blank | The deployment CSP must allow `frame-src https://verification-center.tinfoil.sh`. |
| Plugin row cannot be toggled | The root bundle and a plugin bundle likely both declare the same row id. Remove one. |

## Compatibility

| Component | Supported |
| --- | --- |
| DSH | `>=0.2.2-rc.1 <0.3.0` |
| Node | `^24.22.1 || >=26.12.1` |
| Tinfoil SDK | `tinfoil ^1.4.0` (declared by each plugin that uses the SDK) |
| MCP client | `@modelcontextprotocol/client ^2.4.0` |
| pnpm | `11.27.0` for this workspace |

The provider catalog is a static snapshot; a model added or removed upstream needs a plugin update
until runtime discovery lands.

## Data retention and cleanup

- Documents cache: `$DSH_HOME/cache/dsh-tinfoil-documents/conversions`. Delete the directory to
  reclaim space or remove converted document content. The cache is unencrypted user data.
- Speech output: durable attachments under the host's attachment root; delete through the attachment
  tooling or the host's normal cleanup.
- Redaction, decisions, and audio do not cache requests or responses.
- Web searches and pages are not cached or logged by the plugin.
- Tinfoil SDK prompt-cache scoping uses `~/.tinfoil/user_cache_secret` by default. Single-owner DSH
  hosts are fine; a shared multi-user host must set `TINFOIL_USER_CACHE_SECRET` per end user.
