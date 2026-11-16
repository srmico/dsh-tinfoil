# Local Tinfoil proxy

This directory runs the official
[`tinfoil-proxy`](https://github.com/tinfoilsh/tinfoil-proxy) in Docker Compose. It is optional:
the provider's default `sdk` mode verifies the enclave through the Tinfoil SDK and needs no proxy.

The proxy verifies the Tinfoil router enclave, pins the attested TLS key, and forwards ordinary
OpenAI-compatible traffic from `http://127.0.0.1:3301/v1` to the enclave. It stores no API key; it
forwards the client's `Authorization` header.

The stack lives in the plugin package source under
`packages/dsh-tinfoil-provider/proxy/` but is excluded from the published npm tarball by the
package's `files` allowlist. It is not installed with the plugin.

## Requirements

- Docker Compose v2, or rootless Podman with a Compose provider.
- Outbound network access to Tinfoil's attestation and router endpoints.

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
```

The `.env` file is optional; it only changes the host port. Do not put `TINFOIL_API_KEY` here.

Check the endpoint:

```sh
curl -fsS http://127.0.0.1:3301/v1/models \
  -H "Authorization: Bearer $TINFOIL_API_KEY"
```

The first request performs attestation and can take a few seconds.

## Point the plugin at it

Override the provider row in the profile patch:

```yaml
- id: tinfoil-provider
  config:
    mode: proxy
    baseURL: http://127.0.0.1:3301/v1
```

The patch replaces the whole row config; restate any other keys the row needs. `TINFOIL_API_KEY`
still comes from the DSH launch environment or `$DSH_HOME/.env`.

## Security

- The proxy has no authentication of its own. The compose file binds it to `127.0.0.1`; keep it
  there or on a trusted private network. Do not expose it to the internet.
- The client's API key travels to the proxy over loopback and then to the attested enclave. A remote
  proxy needs a trusted TLS connection.
- The proxy is not a confidential VM. It verifies and pins the remote enclave; it does not make the
  local host trusted.
- The proxy image is pinned by multi-arch index digest. Update the digest deliberately when
  upgrading, and re-run the Compose stack.

## Stop

```sh
docker compose down
```
