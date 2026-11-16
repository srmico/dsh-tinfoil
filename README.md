# dsh-tinfoil

Tinfoil integration for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):
document conversion, PII redaction, typed decisions, audio transcription/speech, web search/fetch,
a Tinfoil model route, and a Web verification surface.

## Quick start

```sh
# All capabilities:
dsh plugin add @srmico/dsh-tinfoil

# Or one capability:
dsh plugin add @srmico/dsh-tinfoil-pii
```

Export a Tinfoil API key in the launch environment or `$DSH_HOME/.env`:

```sh
export TINFOIL_API_KEY="..."
```

Then boot the profile and, in a Web-backed profile, open **Settings → Tinfoil** to see attestation
state. The key is read per request and is never stored in profile configuration.

Install the root bundle **or** individual plugin bundles, not both. Both declare the same row ids;
DSH keeps one live entry and the Plugins UI marks the duplicate row unaddressable.

Packages are released in lockstep. Pin a stable version with `@srmico/dsh-tinfoil@<version>`; install
prereleases with `@srmico/dsh-tinfoil@next`.

## Packages

| Package | Role |
| --- | --- |
| [`@srmico/dsh-tinfoil`](package.json) | Root meta-bundle: inserts all plugin rows and pins the base `web` row to Tinfoil. |
| [`@srmico/dsh-tinfoil-lib`](packages/dsh-tinfoil-lib/README.md) | Internal shared source: SDK transport, attestation contract, bounded HTTP helpers, config validation. Bundled into each plugin at build time; not published. |
| [`@srmico/dsh-tinfoil-documents`](packages/dsh-tinfoil-documents/README.md) | `read_document`, `read_document_as_image`, conversion cache, and the native `read` redirect. |
| [`@srmico/dsh-tinfoil-pii`](packages/dsh-tinfoil-pii/README.md) | `redact_text` and `redact_file` through Tinfoil's attested privacy filter. |
| [`@srmico/dsh-tinfoil-decisions`](packages/dsh-tinfoil-decisions/README.md) | `decisions` typed questions, calibrated probabilities, and an opt-in pre-execute gate. |
| [`@srmico/dsh-tinfoil-audio`](packages/dsh-tinfoil-audio/README.md) | `transcribe_audio`, `transcribe_audio_to_file`, and `synthesize_speech`. |
| [`@srmico/dsh-tinfoil-web`](packages/dsh-tinfoil-web/README.md) | `tinfoil` search/fetch providers on `ctx.web`, attested or explicit endpoint. |
| [`@srmico/dsh-tinfoil-provider`](packages/dsh-tinfoil-provider/README.md) | `tinfoil` LLM route, six-model catalog, `sdk`/`proxy`/`direct` transports, native web search. |
| [`@srmico/dsh-tinfoil-verification`](packages/dsh-tinfoil-verification/README.md) | Attestation registry, Web settings page, and composer status-bar lock. |

## What it does

- Converts PDF, DOCX, PPTX, XLSX, HTML, and CSV through Tinfoil's attested document endpoint, or a
  self-hosted compatible endpoint, caching each conversion by content and converter identity.
- Returns page-level Markdown with `char_offset` continuation and page PNGs as durable attachments.
- Redirects native `read` calls on document paths to `read_document`.
- Redacts strings and UTF-8 text files without returning original span values.
- Answers up to 64 typed decision questions with calibrated probabilities and token usage.
- Transcribes audio and synthesizes speech through attested endpoints.
- Registers `tinfoil` web search/fetch providers; batches concurrent fetches; supports an explicit
  unattested Exa/local MCP endpoint.
- Registers Tinfoil as a DSH model provider with SDK attestation by default, an optional local proxy,
  and an explicit direct mode. Native web search is on by default.
- Collects live verification documents from every loaded plugin into one registry, verifies all
  attestable plugins automatically at startup and on an interval, and embeds Tinfoil's verification
  center in the Web UI.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0`.
- Node `^24.22.1 || >=26.12.1`.
- `TINFOIL_API_KEY` in the launch environment or `$DSH_HOME/.env` for hosted calls. It is not needed
  in documents `endpoint` mode or web `endpoint` mode.
- A profile that mounts the seams the selected plugins need: `ctx.tools` for the tool plugins,
  `ctx.fs`/`ctx.workingDirectory` for file flows, `ctx.attachments` for page images and speech,
  `ctx.web`/`tool-web` for the web tools, and `ctx.llm` for the provider. `dsh-base`, headless, and
  the Web app cover the common set; `dsh-sdk-minimal` needs manual `web`/`tool-web` rows.
- A Web-backed profile with `ctx.connection` for the verification page and composer lock.
- Optional Docker Compose or rootless Podman for the documents self-hosted stack or the local
  attested proxy.

## Security and attestation

Hosted calls use Tinfoil's `SecureClient`: the enclave is verified before data is sent. Documents
`endpoint`, web `endpoint`, provider `proxy`, and provider `direct` are explicit operator choices;
`endpoint` and `direct` are unattested. The verification UI labels each mode honestly.

Plain HTTP is accepted only for loopback. `allowInsecureHttp: true` is an explicit opt-in for a
trusted private network. Keys are read from the configured environment variable, never stored in
profiles or logs. The conversion cache is unencrypted user data; delete it to remove content. See
[Security](docs/SECURITY.md) for the threat model, data flows, and residual dependency risk.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
```

`lib/` is not committed. The build compiles the internal `dsh-tinfoil-lib` source first, then each
plugin build bundles its JavaScript and declarations with [tsdown](https://tsdown.dev), inlining the
private library. Published plugins therefore have no runtime dependency on a separate Tinfoil library
package. The verification browser half is the hand-authored `client.js`; the build syntax-checks it.
Automated tests are deferred until after the manual ergonomics pass. CI covers typecheck, build, and
pack validation. See [Development](docs/DEVELOPMENT.md) for a local profile and the ergonomics
checklist.

## Releases

Releases are tag-driven and manual: a maintainer creates a `vX.Y.Z` tag and dispatches the release
workflow, which publishes the lockstep packages and attaches the exact npm tarballs and `SHA256SUMS`
to a GitHub Release. Stable versions use `latest`; prereleases use `next`. See
[Releasing](docs/RELEASING.md).

## Contributing

Public contributions are welcome as pull requests. PRs do not start CI automatically; a maintainer
reviews the diff and runs CI manually with
`gh workflow run ci.yml --ref main -f pr=<number>`. Do not expect a PR workflow run before that.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Security](docs/SECURITY.md)
- [Development](docs/DEVELOPMENT.md)
- [Releasing](docs/RELEASING.md)
- [Repository rulesets](.github/rulesets/README.md)
- [Roadmap](docs/ROADMAP.md)
- [Documents plugin](packages/dsh-tinfoil-documents/README.md)
- [PII plugin](packages/dsh-tinfoil-pii/README.md)
- [Decisions plugin](packages/dsh-tinfoil-decisions/README.md)
- [Audio plugin](packages/dsh-tinfoil-audio/README.md)
- [Web plugin](packages/dsh-tinfoil-web/README.md)
- [Provider plugin](packages/dsh-tinfoil-provider/README.md)
- [Verification plugin](packages/dsh-tinfoil-verification/README.md)
- [Internal shared source](packages/dsh-tinfoil-lib/README.md)

## License

MIT. See [LICENSE](LICENSE).
