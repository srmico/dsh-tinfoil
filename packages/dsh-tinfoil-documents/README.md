# @srmico/dsh-tinfoil-documents

Document extraction for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through
Tinfoil's attested document endpoint or a self-hosted compatible endpoint.

## Installation

```sh
# All Tinfoil capabilities:
dsh plugin add @srmico/dsh-tinfoil

# Documents alone:
dsh plugin add @srmico/dsh-tinfoil-documents
```

The package is a plugin and a bundle, so a standalone install activates its row. Do not install the
root bundle and this package together; the duplicate row id becomes unaddressable in the Plugins UI.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `read_document` | `file_path`, optional `page_start`, `page_end`, `char_offset` | Extracted Markdown for a page range. Defaults to the first 10 pages. `char_offset` continues a response truncated by `maxOutputChars`. |
| `read_document_as_image` | `file_path`, optional `page_start`, `page_end` | Page PNGs as durable image attachments; default one page, at most 10 per call. Requires an image-capable model route. |

`read_document` also redirects native `read` calls on supported document paths. Scanned pages fail
with `SCANNED_PAGES_UNSUPPORTED`; use `read_document_as_image` until OCR lands.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0`, Node `^24.22.1 || >=26.12.1`.
- A profile with `tools`, `fs`, and `workingDirectory`; page images also need `attachments` and `llm`.
- `TINFOIL_API_KEY` for the hosted endpoint. It is not needed when `endpoint` is set.

## Configuration

```yaml
- id: tinfoil-documents
  config:
    endpoint: http://127.0.0.1:5000
```

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `TINFOIL_API_KEY` | Environment variable holding the key. |
| `endpoint` | unset | Self-hosted base URL. Bypasses `SecureClient` and the key. |
| `allowInsecureHttp` | `false` | Allow plain HTTP to a non-loopback endpoint. Use only on a trusted private network. |
| `cacheDir` | `$DSH_HOME/cache/dsh-tinfoil-documents/conversions` | Cache root. |
| `maxCacheBytes` | `1073741824` (1 GiB) | Disk budget. |
| `cacheTtlMs` | `7776000000` (90 days) | Eviction age. |
| `maxInputBytes` | `52428800` (50 MiB) | Source size cap. |
| `maxResponseBytes` | `268435456` (256 MiB) | Conversion response cap. |
| `requestTimeoutMs` | `300000` | Conversion deadline, including attestation. |
| `maxOutputChars` | `100000` | Per-call text cap. |
| `defaultPageWindow` | `10` | Pages returned when `page_end` is omitted. |
| `maxPages` | `2000` | Maximum page count accepted from one conversion. |
| `includeProviderErrorDetail` | `false` | Include bounded provider detail in model-visible errors. Treat it as untrusted. |

## Cache and attestation

Hosted mode verifies the enclave before document bytes are sent and has no unverified fallback.
`endpoint` mode is an explicit unattested opt-in and sends no Tinfoil key.

The cache key hashes the converter identity (hosted router config repo or normalized endpoint URL),
the source extension/media type, and the source bytes. Manifest version 2 records whether the
producer was security-verified and refuses attested entries without verification. Switching between
hosted and endpoint mode never reuses the other mode's entry. Cache files are `0600` under a `0700`
root; page paths are validated and reads are capped.

## Limitations

- OCR is deferred; scanned pages fail closed.
- One document per call; no multi-file batch.
- The current Web UI does not preview page images outside normal attachments.
- No automated tests yet.

## Development

Build and typecheck from the repository root; see
[Development](https://github.com/srmico/dsh-tinfoil/blob/main/docs/DEVELOPMENT.md).

## License

MIT.
