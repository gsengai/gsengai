# AGENTS.md

Guidance for AI-assisted work in this repository — and a briefing for human contributors. The rules below are project law; most are enforced by tests, all are enforced by review. (`CLAUDE.md` imports this file, so Claude Code and AGENTS.md-reading agents share one source of truth.)

## Non-negotiables

1. **Positioning**: all user-facing copy says "supports compliance with EU AI Act Article 50 and California SB 942" — never "makes you compliant," "ensures/guarantees compliance," or anything promising a legal outcome. Not legal advice. Enforced by the positioning-lint tests.
2. **Privacy**: hashes and metadata only — raw prompts and outputs never persist, in the store or in any export. Enforced by canary tests (in `packages/core/test/store.test.ts`, `packages/core/test/export.test.ts`, and the media canary in `packages/c2pa/test/c2pa.test.ts`). Never delete, skip, or weaken a canary test.
3. **Append-only**: the evidence store has no update or delete path (API or SQL). The hash chain stays intact; `verifyChain()` breaks are reported, never suppressed.
4. **Ingredient preservation**: never overwrite an existing C2PA manifest — chain it as a parent ingredient (PRD B3, ADR-0015).
5. **Wrappers never mutate or block model responses**: hash in memory, append a record, return the response unmodified. Fail-open is the default (warn + lost-record counter); `failMode: 'strict'` is opt-in.
6. **Green gates before every commit**: `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck` — all four, no exceptions.
7. **Dev certificates are opt-in only**: `createImageSigner` signs with the bundled dev key only when passed `devCertificates: true`, and throws for every other incomplete configuration. Never reintroduce a fallback to the bundled key (ADR-0038). Enforced by the certificate-selection tests in `packages/c2pa/test/c2pa.test.ts`.
8. **Old stores keep verifying**: a null `signer_cert_sha256` is left out of the hashed record body. Any change to hashing or the record shape must keep the 0.2.1 fixture upgrade test (`packages/core/test/upgrade.test.ts`) passing. Never modify or regenerate its fixture, `packages/core/test/fixtures/store-core-0.2.1.db` (ADR-0039).

## Sharp edges

- **Never import `@contentauth/c2pa-node` directly** — anywhere, including tests. It loads its native binary lazily, so a successful import proves nothing, and the binary can be missing or built for another platform (install script blocked, no prebuilt); all access goes through the backend resolver in `packages/c2pa/src/backend.ts`, which probes the native module and falls back to c2patool (ADR-0035, ADR-0042). A direct import bypasses that fallback.
- **On every `@contentauth/c2pa-node` upgrade, re-check `packages/c2pa/src/settings.ts`** against the settings schema of the c2pa-rs version it bundles. c2pa-rs ignores unknown keys silently, and its defaults are not offline (`remote_manifest_fetch` defaults to `true`), so a renamed key quietly breaks the no-network guarantee. Also check that both backends still produce equivalent manifests (ADR-0042).
- Keep the `VERSION` constant in `packages/c2pa/src/constants.ts` in step with the package version on release — it is recorded inside every signed manifest.
- Bump `@gsengai/core` and `@gsengai/c2pa` together and publish core first: c2pa's dependency range on core is written from core's version at pack time (`RELEASING.md`).
- Publishing is manual — see `RELEASING.md` (including the 24-hour tombstone rule for interrupted publishes). Do not attempt to automate publishing; the blockers are tracked in issue #2.
- The bundled dev certificates are intentionally untrusted; keep every place that touches them honest about it.
- The secret-scanner allowlist (`.gitleaks.toml`, `.github/secret_scanning.yml`) covers exactly `packages/c2pa/dev-certs/dev-private-key.pem`. Never widen it to a directory, a glob, or `*.pem`: an alert on any other file is a real incident (`SECURITY.md`). The guard test `packages/c2pa/test/secret-scan-allowlist.test.ts` enforces this, and the CI `secret-scan` job runs gitleaks over the full history with that config (ADR-0037, ADR-0041).
- `main` is protected by the "Protect main" ruleset: `gates (ubuntu-latest)`, `gates (macos-latest)`, and `secret-scan` must pass before a merge, force-pushes and deletion are blocked, and nobody can bypass it — every change lands through a PR. Those check names are load-bearing: renaming a job or matrix entry in `.github/workflows/ci.yml` requires updating the ruleset (Settings → Rules → Rulesets) in the same change, or every PR waits for a check that never runs.

## Orientation

- Architecture decisions: `DECISIONS.md` (append-only ADR log — supersede, don't rewrite).
- What is and is not captured: `docs/capture-coverage.md`.
- Production concerns (platform support, cert handling, store topology, failure modes): `docs/production.md`.
- CI runs the full suite on the native C2PA backend on Ubuntu and macOS (`GSENGAI_EXPECT_BACKEND` turns a silent fallback into a failure) and forces the c2patool fallback over the C2PA tests on Ubuntu, so both backends stay covered — keep it that way.
