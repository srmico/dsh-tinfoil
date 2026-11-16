# Security

## Trust model

The hosted path uses Tinfoil's `SecureClient`: it verifies the enclave and encrypts the request body
before data leaves the host. There is no unverified fallback in `sdk` mode. The self-hosted documents
endpoint, the web plugin's `endpoint` mode, the provider's `proxy` mode, and the provider's `direct`
mode are explicit operator choices with different trust properties:

| Mode | Verification | Key handling |
| --- | --- | --- |
| `sdk` | Tinfoil SDK, in the host | `Authorization` header inside the encrypted request |
| `proxy` | Local `tinfoil-proxy` | Forwarded in the `Authorization` header over loopback |
| `endpoint` | None | No Tinfoil key; endpoint-specific key only if configured |
| `direct` | None | `Authorization` over HTTPS |

`endpoint` and `direct` are the only modes that send data without attestation. They are never
implicit, and the verification UI labels them as unattested.

## What leaves the host

- Documents: file bytes go to the conversion endpoint. In `endpoint` mode they go to the URL the
  operator configured and no Tinfoil key is sent.
- PII: text goes to the attested privacy filter. Original values, summary, span text, labels, and
  offsets are dropped before validation and never returned or logged.
- Decisions: the input, questions, and (when the gate is enabled) pending tool name/arguments go to
  `/v1/decisions`. The gate is advisory, not a security boundary.
- Audio: audio bytes or requested speech text go to the attested audio endpoints.
- Web: queries and fetch URLs go to the Tinfoil websearch enclave, or to the configured MCP endpoint
  in `endpoint` mode. PII/injection headers are on by default in attested mode.
- Provider: prompts, attachments, and model requests go through the configured transport. Native web
  search adds Tinfoil's request-side search options.

API keys are read from the environment named by `apiKeyEnv`; keys are never stored in profile
configuration, returned in tool output, or written to logs. Provider `headers` rejects
`authorization`, `x-api-key`, `host`, `content-length`, and `connection`.

## Cache and attachments

- The conversion cache is keyed by converter identity + source extension/media type + bytes. A
  document converted through an unattested endpoint cannot be replayed as a verified conversion.
- Manifest version 2 records whether the producing client was security-verified; attested entries
  without verification are rejected.
- Cache files are `0600` under a `0700` root; page paths are validated, symlinked page files are
  rejected, reads are capped against the manifest, and total size is checked before writing.
- The cache is unencrypted. Delete it to remove converted content. Speech output is a durable
  attachment and is equally sensitive.

## Prompt-cache scoping

The Tinfoil SDK automatically scopes prompt caching with `user_cache_secret`, resolved from a client
option, `TINFOIL_USER_CACHE_SECRET`, or `~/.tinfoil/user_cache_secret` (generated on first use). The
default is host-wide. A single-owner DSH host is the intended deployment. A host shared by multiple
end users must set a per-user secret; per-session scoping is on the roadmap.

## Verification UI

The Settings page and composer lock embed `https://verification-center.tinfoil.sh` in a cross-origin
iframe. The parent accepts messages only from that exact origin and the current iframe window, and
posts documents only to that origin. The iframe carries a sandbox and `referrerPolicy="no-referrer"`.
A deployment that sets its own CSP must allow
`frame-src https://verification-center.tinfoil.sh`.

The snapshot and verify routes are exact authenticated Fetch routes under `/api`. Responses are
`cache-control: no-store` and `x-content-type-options: nosniff`; the payload contains only public
attestation evidence. The host registry is memory-only.

## Dependency and transport policy

- Plain HTTP is accepted only for literal loopback hosts. `allowInsecureHttp: true` is an explicit
  opt-in for a trusted private network; keys must never be sent over non-loopback HTTP.
- Attested and endpoint requests use `redirect: "error"` so a redirect cannot replay a body to
  another origin.
- Provider error bodies are excluded from model-visible errors by default. Documents/audio can opt
  in with `includeProviderErrorDetail: true`; the detail is bounded and must be treated as untrusted.
- `@modelcontextprotocol/client` 2.4.0 inlines fast-uri 3.1.8, which has four advisories fixed in
  3.1.9. No newer MCP client release is available at the time of writing. The plugin raises the
  minimum to `^2.4.0`, uses MCP only in the web plugin, and treats `endpoint` mode as the exposed
  path. Track the upstream fix before relying on endpoint mode with untrusted MCP servers.
- `pnpm audit --prod` is clean for the installed production tree; it cannot see inlined dependencies.
- The workspace enables `autoInstallPeers` so the TypeScript compiler can resolve DSH peer types;
  profiles keep `autoInstallPeers: false` and receive those peers from the DSH installation. Build
  scripts for the transitive `@google/genai`/`protobufjs` packages are denied in the workspace.
- No credentials are committed. `.env`, `.tinfoil-api-key`, `.tmp/`, and cache directories are
  ignored; package `files` allowlists exclude source-only stacks, env files, tests, and maps.

## Release integrity

- Only maintainers with GitHub Write permission can push branches, create tags, or run manual
  workflows. Public contributors can fork and open PRs, but PRs never start a workflow.
- CI has no secrets and uses a read-only token. Manual PR CI runs only after a maintainer reviews the
  code; it checks out the PR head, disables install scripts, and does not persist checkout credentials.
- Releases are dispatched manually from a tag, behind the `npm-publish` environment. The build job
  packs once; the publish job uses those exact tarballs and no dependency install.
- npm publishing uses OIDC Trusted Publishing with provenance; there is no long-lived `NPM_TOKEN` after
  the one-time `0.1.0` bootstrap. The bootstrap token is revoked immediately, and each package gets a
  Trusted Publisher rule.
- Dependency caching is deliberately not used; every CI run resolves a fresh pnpm store.
- Third-party actions are pinned to full commit SHAs, and Dependabot keeps those pins current.
