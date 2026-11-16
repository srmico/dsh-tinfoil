# Self-hosted Tinfoil document service

This directory runs the same open-source document conversion service that backs Tinfoil's
[`/v1/convert/file`](https://docs.tinfoil.sh/guides/document-processing) endpoint:
[`tinfoilsh/confidential-doc-upload`](https://github.com/tinfoilsh/confidential-doc-upload).

It is optional. The plugin uses the attested Tinfoil endpoint by default. The `endpoint` config
option makes it call this local service instead.

The stack lives in the plugin package source under
`packages/dsh-tinfoil-documents/self-hosted/`, but it is excluded from the published npm tarball by
that package's `files` allowlist. It is not installed with the plugin.

## What runs

Two containers from the pinned public image
`ghcr.io/tinfoilsh/confidential-doc-upload@sha256:4637a6e5358f8ac80478acf516bf705971b1673d1e2aa022dfe6d66a3d8ff487`
(upstream release `0.0.40`, commit `814f7d3`, `linux/amd64`):

| Service | Role |
| --- | --- |
| `doc-upload` | Go router exposing `POST /v1/convert/file` on host `127.0.0.1:5000` |
| `doc-parser` | Go/Python + MuPDF parser, reachable only over the shared Unix socket, with no network |

The parser runs read-only, without capabilities, with `no-new-privileges`, and in its own network
namespace. The router gets the optional Tinfoil key for OCR modes.

## Requirements

- Docker Compose v2, or rootless Podman with a Compose provider (`podman compose` or
  `podman-compose` 1.6+).
- Roughly 4 GiB of memory available to the container runtime by default (2 GiB per service). The
  host also needs room for Docker/Podman itself.
- On arm64 hosts, qemu binfmt emulation for `linux/amd64`.
- Rootless Podman needs cgroups v2 with systemd delegation only if you want the `mem_limit`/`cpus`
  limits enforced. Check with `podman info --format '{{.Host.CgroupsVersion}}'`.

## Start

From this directory:

```sh
cp .env.example .env
docker compose up -d
```

Rootless Podman:

```sh
cp .env.example .env
podman compose up -d
# or, with podman-compose:
podman-compose up -d
```

The `.env` file is optional. `TINFOIL_API_KEY` is only needed for OCR/VLM modes; `images` mode
needs no key. Keep `.env` out of version control.

Check health:

```sh
curl -fsS http://127.0.0.1:5000/health
```

Without a key the router reports `degraded` with `"vlm": false` and still returns HTTP 200.
With a key it reports `ok`. A `503` means the parser is not ready.

Test a conversion directly:

```sh
curl -fsS -F "files=@/path/to/document.pdf" \
  "http://127.0.0.1:5000/v1/convert/file?mode=images"
```

The response has the same `document.pages[]` shape the plugin already parses.

## Point the plugin at it

Add the row config in the profile's patch layer:

```yaml
- id: tinfoil-documents
  config:
    endpoint: http://127.0.0.1:5000
```

The plugin then requests
`http://127.0.0.1:5000/v1/convert/file?mode=images`, does not load `SecureClient`, and sends no
`Authorization` header. `TINFOIL_API_KEY` is not required for the plugin in this mode.

The patch config replaces the whole row config. If the row also needs other keys, restate them.

## OCR and VLM modes

`mode=images` - the only mode the plugin uses - is fully local. Parsing, text extraction and page
PNG rendering happen in `doc-parser`; no Tinfoil request is made.

`text` (scanned pages only), `vision` and `vlm` call Tinfoil's hosted VLM through `tinfoil-go`.
Set `TINFOIL_API_KEY` in this directory's `.env` to enable them. The container verifies the Tinfoil
enclave and needs outbound access to `atc.tinfoil.sh`, `tuf-repo-cdn.sigstore.dev`,
`inference.tinfoil.sh` and the ATC-advertised router (`router.inf6.tinfoil.sh` at research time).
Those modes consume Tinfoil inference tokens; self-hosting only removes the per-request conversion
charge.

Upstream has no setting for a local OpenAI-compatible VLM. Making OCR fully local would require
patching `internal/server/vlm.go` in a fork.

## Security

- The raw service has no authentication. Keep the published port on `127.0.0.1` or a trusted
  private network, and never expose it to the internet.
- This is not a confidential VM. The host and container runtime can see document bytes. The
  container's parser isolation still applies, but local runs do not carry Tinfoil's remote
  attestation guarantees.
- The Tinfoil API key is passed as an environment variable. Anyone who can inspect the container
  can read it; do not use shared hosts for VLM modes.
- `x-podman.in_pod: false` is required for rootless Podman. Without it, `podman-compose` puts both
  services in one pod sharing a network namespace, which defeats `doc-parser`'s `network_mode:
  none`. Do not remove it.

## Rootless Podman notes

- `x-podman.in_pod: false` keeps the parser out of the router's pod. Docker Compose ignores this
  extension.
- The socket uses a named volume, so no SELinux `:Z` bind-mount relabeling is needed.
- Container UIDs 65532/65533 map into the rootless user namespace normally; do not use
  `--userns=keep-id`.
- Port 5000 is unprivileged, so rootless port publishing works.
- If `mem_limit` or `cpus` is rejected on a rootless setup, remove those lines from
  `docker-compose.yml`. The parser still enforces `PARSER_MEMORY_LIMIT_MB=1024` and
  `PARSER_WORKERS=1`, and the router's admission limits still apply.
- Older `podman-compose` releases may ignore the `service_healthy` dependency condition. The router
  recovers once the parser socket exists; a first request may return `503` until then.

## Resource tuning

Defaults are sized for a single local user and one conversion at a time:

| Setting | Default |
| --- | --- |
| `doc-upload` memory / CPUs | `2g` / `2` |
| `doc-parser` memory / CPUs | `2g` / `2` |
| Router active / queued requests | `1` / `2` |
| Parser workers | `1` |
| Parser per-process memory | 1024 MB |

Override the Compose limits in this directory's `.env` with `DOC_ROUTER_MEMORY`,
`DOC_ROUTER_CPUS`, `DOC_PARSER_MEMORY` and `DOC_PARSER_CPUS`. For very large PDFs, also raise
`PARSER_MEMORY_LIMIT_MB` (maximum 4096) and the parser service memory in `docker-compose.yml`.

## Updating and teardown

The image is pinned by digest. To update, pick a new release from the
[GHCR package](https://github.com/tinfoilsh/confidential-doc-upload/pkgs/container/confidential-doc-upload),
review its upstream changes, replace the digest in `docker-compose.yml`, then:

```sh
docker compose pull
docker compose up -d
```

Stop and remove the stack, including the socket volume:

```sh
docker compose down -v
```
