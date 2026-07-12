# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-07-12

Docs-only release.

### Added

- Per-package READMEs, so the npm package pages document install, usage, and each package's guarantees (previously the pages showed no README).
- README badges: CI, npm version, license, Node.

## [0.2.0] — 2026-07-12

### Added

- **Cross-platform C2PA image signing** ([#1](https://github.com/gsengai/gsengai/issues/1)): `@gsengai/c2pa` now signs on Linux, Windows, and Intel macs through an automatic [c2patool](https://github.com/contentauth/c2pa-rs/tree/main/cli) fallback, alongside the native `@contentauth/c2pa-node` path on macOS Apple Silicon. The backend is auto-detected at first use; `GSENGAI_C2PA_BACKEND=native|c2patool` forces one, and the c2patool binary can be pointed at via `GSENGAI_C2PATOOL_PATH` or the new `c2patoolPath` option of `createImageSigner`. Both backends produce equivalent manifests, keep the offline discipline (no OCSP, no remote fetches, no TSA), and never copy private key material. See the platform note in `docs/production.md`.
- CI now runs an ubuntu + macOS matrix so both signing backends stay covered.

### Changed

- Correction to the 0.1.2 notes below: OIDC trusted publishing was reverted (blocked upstream, tracked in [#2](https://github.com/gsengai/gsengai/issues/2)), so 0.1.2 was tagged but never published to npm. Releases are published manually per `RELEASING.md`; this release supersedes 0.1.2.

## [0.1.2] — 2026-07-09

### Changed

- Documented that C2PA image signing currently requires macOS on Apple Silicon — an upstream `@contentauth/c2pa-node` prebuilt-binary limitation; a cross-platform `c2patool` fallback is tracked in [#1](https://github.com/gsengai/gsengai/issues/1).
- README install notes and a platform-support section; added a production integration guide (`docs/production.md`).
- Releases now publish via npm OIDC trusted publishing with automatic provenance.
- Unified all package versions at 0.1.2.

## [0.1.1] — 2026-07-09

### Changed

- `@gsengai/ai-sdk` republished (its 0.1.0 was tombstoned by an interrupted first publish).

## [0.1.0] — 2026-07-09

Initial public release.

### Added

- **`@gsengai/core`** — append-only, hash-chained evidence store (SQLite), text output fingerprinting (raw and normalized SHA-256), a lost-record counter, and audit exports: JSONL, CSV, and a human-readable Markdown audit report. `gsengai-audit` CLI. Hashes and metadata only; raw content never persists.
- **`@gsengai/openai`**, **`@gsengai/anthropic`**, **`@gsengai/ai-sdk`** — wrappers that log an evidence record per text generation across streaming and non-streaming calls, returning the model response unmodified. Fail-open by default, strict mode opt-in.
- **`@gsengai/c2pa`** — C2PA signing for PNG and JPEG declaring AI generation, preserving any existing manifest as a chained ingredient. Development certificates bundled for integration testing only.
- **`@gsengai/disclosure`** — React components and plain-HTML equivalents for Article 50 interaction notices and AI-content labels, with the official EU transparency icons in English, German, and French.
- Interactive local demo, quickstart and audit-export examples, and the architecture decision log in `DECISIONS.md`.
