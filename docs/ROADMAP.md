# Roadmap

The initial plugin set and the private shared source are implemented. Remaining work is ordered by
user impact and release risk.

## P1 — Next

- **Manual ergonomics pass** — exercise every plugin, config, and verification state before locking
  behavior into automated tests. See `docs/DEVELOPMENT.md`.
- **Automated tests** — after the ergonomics pass: unit tests for payloads, config, cache
  identity/limits, web mapping/batching, gate rules, and verification states. CI already covers
  typecheck, build, and package payload validation.
- **OCR and document modes** — add `read_document_with_ocr`; expose `images`/`text`/`vlm` modes;
  include the mode in the cache identity. Scanned PDFs currently fail closed.
- **Live model catalog** — read the public `GET https://inference.tinfoil.sh/v1/models` response,
  merge chat metadata, cache it, and support model removal. The shipped six-model catalog is a
  snapshot.
- **Voice input** — register a DSH `ctx.speechToText` provider for Tinfoil whisper/voxtral, enabling
  the experimental composer voice input. The audio plugin is tool-only today.
- **Usage and cost visibility** — surface per-call usage/cost where Tinfoil exposes it, and add a
  side-call usage projection.
- **Release pipeline** — implemented: LICENSE, lockstep plugin → root publish order with the shared
  source bundled into each plugin, tag-driven manual release workflow, npm OIDC/provenance, and
  GitHub Release tarballs with checksums. Raw `github:` installs remain unsupported; use the Release
  tarballs. See `docs/RELEASING.md`.

## P2 — Later

- Quota-aware errors: distinguish 402 billing pauses and `insufficient_quota` from transient 429s.
- Native web-search tuning: `search_context_size`, domain/date filters, content mode; citation
  pass-through where pi-ai allows it.
- Attested self-hosted documents: an `endpointRepo`-backed `SecureClient` mode for Tinfoil
  Containers, instead of the current plain HTTP self-hosted endpoint.
- Audio: translations, per-model voice validation, and chat-audio input.
- Verification: multi-plugin comparison grid; freshness/revocation caveat; revisit iframe
  sandbox capabilities if the widget changes.
- Per-user prompt-cache scoping for shared multi-user hosts.
- Provider Models-page editing and runtime catalog UI.

## P3 — Only with a consumer

- Embeddings (`nomic-embed-text`) once DSH has an embedding seam or a concrete tool consumer.
- Generic MCP bundle; admin API integration.

## Not planned

Image generation (no image model in the catalog), `/v1/moderations` (the safety model is chat-only),
realtime audio (no DSH streaming consumer; Node-only TLS pinning), and the Tinfoil admin API.

## Release checklist

- [ ] Manual ergonomics pass complete.
- [x] `pnpm build` and `pnpm typecheck` pass for all packages.
- [x] `pnpm build` is run from the root before packing so every plugin bundle contains the current
      shared source.
- [x] `pnpm pack --dry-run` shows only `lib/` (bundled JS and declarations), README, LICENSE,
      locale/icon, `cordis.patch.yml` where applicable, and `client.js` for verification; no source
      files and no private library package.
- [x] No published plugin lists `@srmico/dsh-tinfoil-lib` under `dependencies`; the library package is
      `private` and skipped by recursive publish.
- [ ] Root, standalone, and mixed installs verified.
- [x] LICENSE file and copyright holder chosen.
- [ ] Repository rulesets applied for `main` and `v*`.
- [x] Publish order (plugins → root), exact root pins, and GitHub Release tarballs implemented.
- [x] npm OIDC/provenance, protected tags/environment, and the manual release workflow enabled.
- [ ] `pnpm audit --prod` reviewed; MCP fast-uri advisory tracked upstream.
- [x] Docs updated for the released versions.
