# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
