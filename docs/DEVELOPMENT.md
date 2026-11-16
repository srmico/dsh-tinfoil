# Development

## Build and typecheck

From the repository root:

```sh
pnpm install
pnpm typecheck
pnpm build
```

The workspace enables `autoInstallPeers` so the DSH peer declarations used by the TypeScript
compiler are linked (the DSH profile itself uses `autoInstallPeers: false`; the installation supplies
those peers at runtime). After adding or changing workspace packages, a clean install is the reliable
reset:

```sh
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm typecheck
```

`pnpm install --force` forces a reinstall but leaves the existing `node_modules` tree in place. There
is no separate `pnpm clean` command in this repository.

`pnpm build` compiles the private `dsh-tinfoil-lib` source first, then builds every plugin. A plugin
build runs `tsc --noEmit` for type checking and `tsdown` for bundling: every package import stays
external except the library, whose JavaScript and declarations are inlined into the plugin's
`lib/index.js` and `lib/index.d.ts`. There is no separate published library package and no runtime
link between plugins.

The library source under `packages/dsh-tinfoil-lib/src` is the single source of truth. Edit it there,
never the generated `lib/` output, and always rebuild from the repository root after changing it.
`lib/` is not committed. The verification browser half is the hand-authored `client.js`; its build
runs `node --check` and the host TypeScript compiler.

TypeScript stays on 6.x. tsdown's declaration generator (`rolldown-plugin-dts`) uses the classic
TypeScript compiler API, which the TypeScript 7.0 native package no longer exposes; its TypeScript 7
path requires the `tsgo` API from a 7.1+ beta. Revisit when stable declaration generation supports
TypeScript 7.

To inspect what a package will publish, including its bundled declarations:

```sh
pnpm --filter @srmico/dsh-tinfoil-pii pack --dry-run
```

CI runs typecheck, build, and recursive pack validation. It is maintainer-triggered for PRs and runs
automatically on maintainer branch pushes; see [Releasing](RELEASING.md). Automated tests are still
deferred until after the manual ergonomics pass below.

## Local profile

Use an `sdk-minimal` profile for a small surface:

```sh
dsh --profile dsh-tinfoil-dev --from-default-profile sdk-minimal --dump-config
dsh plugin --profile dsh-tinfoil-dev add /abs/path/to/dsh-tinfoil
dsh --profile dsh-tinfoil-dev --dump-config
```

The root bundle links the workspace packages. To exercise a single capability instead, install that
plugin package directly; its package is also a bundle. Do not install the root bundle and the same
plugin bundle together.

The web plugin needs `ctx.web` and a `tool-web` row. `sdk-minimal` has neither; add the standard
`web`/`tool-web` rows from the plugin README or use a base-backed profile.

## Manual ergonomics checklist

Run this before adding tests, and record findings in `docs/ROADMAP.md`:

- [ ] Install the root bundle in a Web-backed profile and in `sdk-minimal`; confirm all expected rows
      and no startup error.
- [ ] Install one plugin standalone; confirm its row, tool, and config schema appear, and that the
      rest of the integration is absent.
- [ ] Run `dsh --dump-config` for root, standalone, and mixed installs; confirm the mixed case keeps
      one live row and document the unaddressable-row behavior.
- [ ] Call every tool with a normal input, an empty input, an oversized input, an unsupported file,
      a missing key, and an unreachable endpoint. Check the error text is actionable and contains no
      secret, document text, transcript, or PII.
- [ ] Documents: cached second call, page range, `char_offset` continuation, page images, scanned
      page failure, cache invalidation after switching `endpoint`/hosted mode.
- [ ] PII: `redact_text`, `redact_file`, output distinct from input, oversized input.
- [ ] Decisions: predicate/choice/score, refusal, usage footer, gate allow/ask/deny and failure.
- [ ] Audio: transcribe, transcribe-to-file, synthesize, duration/metadata, oversized input.
- [ ] Web: attested search/fetch, endpoint mode, batching, PII note, native-search tool hiding.
- [ ] Provider: SDK mode, proxy mode, direct mode, model selection, native search on/off, image input.
- [ ] Verification: page and composer lock for idle, verified, failed, proxy, endpoint, direct, mixed,
      and a missing plugin; CSP/iframe behavior; automatic startup verification; **Verify all**;
      **Check status**; the 10-second status refresh and 5-minute automatic re-verification.
- [ ] Confirm the verification UI shows “SDK attestation” for SDK-mode plugins.
