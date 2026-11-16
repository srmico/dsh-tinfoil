# @srmico/dsh-tinfoil-pii

PII redaction for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through
Tinfoil's attested privacy filter.

## Installation

```sh
# All Tinfoil capabilities:
dsh plugin add @srmico/dsh-tinfoil

# PII alone:
dsh plugin add @srmico/dsh-tinfoil-pii
```

The package is a plugin and a bundle, so a standalone install activates its row. Do not install the
root bundle and this package together; the duplicate row id becomes unaddressable in the Plugins UI.

## Tools

| Tool | Arguments | Returns | Default input cap |
| --- | --- | --- | --- |
| `redact_text` | `text` | Complete `redactedText` and `spanCount`. | 1 MiB |
| `redact_file` | `file_path`, `output_path` | `inputPath`, `outputPath`, `inputBytes`, `outputBytes`, `spanCount`. No redacted text. | 4 MiB |

`redact_file` reads the source inside the plugin, writes the redacted copy, and keeps the content out
of the model context. `redact_text` returns the complete result because there is no continuation
store; mount the host tool-result spill policy when large strings are expected.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0`, Node `^24.22.1 || >=26.12.1`.
- A profile with `tools`; `redact_file` also needs `fs` and `workingDirectory`.
- `TINFOIL_API_KEY` in the launch environment or `$DSH_HOME/.env`.

## Configuration

```yaml
- id: tinfoil-pii
  config:
    maxTextInputBytes: 1048576
```

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `TINFOIL_API_KEY` | Environment variable holding the key. |
| `maxTextInputBytes` | `1048576` (1 MiB) | `redact_text` UTF-8 cap. |
| `maxFileInputBytes` | `4194304` (4 MiB) | `redact_file` input cap. |
| `maxResponseBytes` | `16777216` (16 MiB) | Provider response cap. |
| `requestTimeoutMs` | `120000` | Redaction deadline, including attestation. |

The 4 MiB provider JSON limit is enforced independently of the file cap; a file at the configured
cap can still be rejected after serialization.

## Security and attestation

Every call uses Tinfoil's `SecureClient` and verifies the `pii-filter.tinfoil.sh` enclave against
`tinfoilsh/confidential-pii-cpu` before text is sent. There is no unverified fallback and no
self-hosted bypass.

The plugin never returns or logs the original text, provider summary, span text, labels, offsets, or
placeholders. The response is parsed with a JSON reviver that drops `text` and `summary` before
validation. Provider error bodies are discarded. The filter is best-effort and primarily English;
a successful call is not a guarantee of anonymization.

Requests and responses are not cached.

## Development

Build and typecheck from the repository root; see
[Development](https://github.com/srmico/dsh-tinfoil/blob/main/docs/DEVELOPMENT.md).

## License

MIT.
