# @srmico/dsh-tinfoil-verification

Attestation registry and Web verification surface for the Tinfoil plugins for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## Installation

```sh
# All Tinfoil capabilities:
dsh plugin add @srmico/dsh-tinfoil

# Verification UI alone:
dsh plugin add @srmico/dsh-tinfoil-verification
```

The package is a plugin and a bundle. It has a host half (`apply`, routes, registry) and a browser
half (`client.js`, attached through `dsh.client`). A standalone install activates its row. Do not
install the root bundle and this package together; the duplicate row id becomes unaddressable in the
Plugins UI.

## How it works

Each capability plugin publishes a target when `ctx.tinfoilAttestation` is mounted:

```ts
ctx.inject(['tinfoilAttestation'], (attestationCtx) => {
  attestationCtx.effect(() => attestationCtx.tinfoilAttestation.register({
    id: 'documents',
    title: 'Document conversion',
    mode: 'sdk',
    configRepo: 'tinfoilsh/confidential-model-router',
    enclaveURL: 'https://inference.tinfoil.sh',
    read: () => converter.verification(),
    verify: async (signal) => { await converter.attest(signal) },
  }), 'tinfoil documents attestation')
})
```

- `read()` is synchronous and must not start network work.
- `verify(signal)` runs the same `SecureClient.ready()` path the plugin uses for requests.
- `mode` is `sdk`, `proxy`, `endpoint`, or `direct`. Only `sdk` targets may declare `verify`;
  `proxy` is reported as externally attested; `endpoint`/`direct` are unattested.
- The registry is memory-only and removes a target, its error, and its in-flight verification when
  the plugin unloads.

## Routes

Both routes are authenticated exact Fetch routes under `/api`; responses are `no-store` with
`nosniff`.

- `GET /api/tinfoil/attestations` — snapshot version 2 with `knownTargets` and loaded entries.
- `POST /api/tinfoil/attestations/verify` — body `{ "id": "documents" }` re-runs one target; an
  empty object (`{}`) re-runs every verifiable target concurrently and returns the refreshed
  snapshot. Unknown ids return 404; malformed bodies and unsupported modes return 400. The host
  verification deadline is 60 seconds per target.

The payload contains only public attestation evidence. It never includes an API key, prompt, session,
or file.

## Browser surfaces

- **Composer status-bar lock** (`conversation.composer.dock`, id `tinfoil-lock`, order `-1`): a
  compact lock left of the turn/step reading. Green closed means SDK-attested or proxy-attested;
  amber closed means configured opt-outs; amber open means incomplete; red open means failure or a
  refresh error. Clicking opens a popover with a selector, **Verify all**, **Check status**,
  metadata, and the embedded verification center.
- **Settings → Tinfoil** (`settings.section`, id `tinfoil`): the full list, mode/enclave/repo,
  release digest, verified-at time, fingerprints, per-step status, errors, and the same iframe.

Known but unloaded plugins appear as “Not loaded” and do not affect the lock. Both surfaces share one
store:

- status is refreshed every 10 seconds (every 30 seconds while the tab is hidden);
- all verifiable targets are verified automatically at startup and again every 5 minutes;
- **Verify all** re-runs every verifiable target immediately;
- **Check status** only re-reads the latest state and does not re-run attestation.

## Iframe

Source: `https://verification-center.tinfoil.sh?showHeader=true&darkMode=<theme>`. The iframe is
cross-origin, sandboxed, and `referrerPolicy="no-referrer"`. Messages are accepted only when
`event.origin` is the center origin and `event.source` is the current iframe window; documents are
posted only to that origin. A deployment that sets its own CSP must allow
`frame-src https://verification-center.tinfoil.sh`.

## Requirements and limitations

- A Web-backed profile with `ctx.connection` and the client module system. Headless and
  `dsh-sdk-minimal` get the host registry but no routes/UI.
- Capability plugins only need the shared source bundled into their own package; the verification
  package is optional.
- Proxy attestation stays external; no host-side document is shown.
- One iframe at a time. A simultaneous multi-plugin grid is deferred.
- No automated tests yet.

## Development

Build and typecheck from the repository root; see
[Development](https://github.com/srmico/dsh-tinfoil/blob/main/docs/DEVELOPMENT.md). The build
syntax-checks `client.js` and compiles the host half.

## License

MIT.
