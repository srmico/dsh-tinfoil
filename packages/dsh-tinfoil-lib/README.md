# @srmico/dsh-tinfoil-lib

Shared transport, attestation, and configuration helpers for the Tinfoil plugins for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This package is internal build source. It is `private`, is never published, and is not an installable
plugin. Each plugin build bundles its JavaScript and declarations with tsdown, which inlines this
library, so published plugins are self-contained. It has no `dsh.bundle`, no plugin row, no icon, and
no locale files.

## What it owns

- `SecureClient` lifecycle, attestation, timeout composition, auth header, redirect policy, and
  verification documents for the Tinfoil SDK transport.
- A bounded request client for explicit unattested HTTP endpoints.
- Bounded response readers, provider error-body parsing, status classification, and detail
  sanitization.
- API-key environment lookup, config validation, HTTP URL policy, and loopback detection.
- The verification registry contract and the canonical attestation target list.
- The native web-search capability contract shared by the provider and web plugins.

## Development

The library source is the single source of truth for all seven plugins. Do not publish it and do not
copy its code into plugin packages; the plugin bundles are generated output.

From the repository root:

```sh
pnpm typecheck
pnpm build
```

`pnpm build` compiles this package first, then every plugin type-checks and bundles its entry. The
plugin's `tsdown.config.ts` inlines this package's JavaScript and declarations. Always rebuild from
the root after changing anything here.

## License

MIT. See the repository root for the license policy.
