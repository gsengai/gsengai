# gsengai

[![CI](https://github.com/gsengai/gsengai/actions/workflows/ci.yml/badge.svg)](https://github.com/gsengai/gsengai/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40gsengai%2Fcore?label=npm)](https://www.npmjs.com/package/@gsengai/core)
[![license](https://img.shields.io/github/license/gsengai/gsengai)](./LICENSE)
[![node](https://img.shields.io/node/v/%40gsengai%2Fcore)](https://nodejs.org)

**Open-source transparency and provenance tooling for AI product teams.**

Supports compliance with **EU AI Act Article 50** (applies 2 August 2026) and **California SB 942** — a technical layer you add in an afternoon:

- **Log and fingerprint** your AI text output — hashes only, raw text never stored
- **Sign AI images** with **C2PA Content Credentials**, preserving any existing provenance
- **Keep an append-only, hash-chained audit log**, exportable for counsel or a regulator
- **Show AI disclosure labels** with the official EU transparency icons (EN / DE / FR)

TypeScript, with drop-in wrappers for the OpenAI, Anthropic, and Vercel AI SDKs.

> **What this does NOT do**
>
> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.
> - It does not embed imperceptible watermarks (MVP). It implements the signed-metadata and logging/fingerprinting layers of a multi-layer marking strategy.
> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.
> - It does not detect third-party AI content.
> - It is not legal advice. Consult qualified counsel about your obligations.

## Who this is for

**Engineering teams shipping generative-AI features** are the integrators: the wrappers, the image signer, and the UI kit are added by developers, whatever your organization's legal classification turns out to be.

The obligations these features support are role-specific, and each law uses its own vocabulary: the EU AI Act places Article 50 duties on *providers* and *deployers* of AI systems; California SB 942 addresses *covered providers* (roughly: a publicly accessible generative-AI system with more than 1,000,000 monthly visitors or users). The definitions differ — an organization can hold one of these roles, several, or none. **gsengai does not determine your role or which obligations apply to you.** That is a legal determination that depends on your system, your deployment context, and how each law defines its terms — make it with qualified counsel, not with this README.

| Obligation the feature supports | Whom the law addresses | Feature |
| --- | --- | --- |
| Informing people they are interacting with an AI system — EU AI Act Art. 50(1) | Providers | `<AIInteractionNotice/>` (`@gsengai/disclosure`) |
| Machine-readable marking of synthetic content — EU AI Act Art. 50(2): audio, image, video, and text | Providers | C2PA manifests for images (`@gsengai/c2pa`); text fingerprinting + evidence log as the fingerprinting/detection layer (`@gsengai/core`) |
| Visible disclosure of deepfakes and of public-interest AI text — EU AI Act Art. 50(4) | Deployers | `<SyntheticContentLabel/>`, `<AIGeneratedBadge/>` (`@gsengai/disclosure`) |
| Latent (machine-readable) disclosure in AI-generated content — California SB 942: image, video, and audio only | Covered providers | C2PA manifests — PNG/JPEG today; gsengai does not yet sign video or audio |
| Offering users a visible ("manifest") disclosure — SB 942 | Covered providers | `@gsengai/disclosure` labels |
| Providing a free public AI-content detection tool — SB 942 | Covered providers | Hash-based detection lookups to build one on (`@gsengai/core`); a hosted detection endpoint is on the [roadmap](./ROADMAP.md) |

Two scope notes worth knowing: Article 50(2) marking covers text, while SB 942's disclosure duties cover image, video, and audio only; and both laws apply from **2 August 2026** (SB 942's operative date was aligned to the EU AI Act's by its 2025 amendments, AB 853).

**Compliance officers, auditors, and counsel** are the second audience: the CSV export and the Markdown audit report (chain-integrity verdict stated up front, limits block included) are written to be handed to you, not just kept by the engineers — see [audit artifacts](#what-is-implemented-today).

## Install

```sh
pnpm add @gsengai/core
# add the wrappers and modules you need:
pnpm add @gsengai/openai @gsengai/anthropic @gsengai/ai-sdk @gsengai/c2pa @gsengai/disclosure
```

Requires Node >= 22. The `@gsengai/*` packages are published on npm. For production integration notes, see [docs/production.md](./docs/production.md).

**Platform support:** text logging and fingerprinting, the evidence store, audit export, and the disclosure kit run anywhere Node 22 runs. C2PA image signing works out of the box on macOS (Apple Silicon) via the native `@contentauth/c2pa-node` binary, and on Linux, Windows, and Intel macs through an automatic [c2patool](https://github.com/contentauth/c2pa-rs/tree/main/cli) fallback — install c2patool ([prebuilt binaries](https://github.com/contentauth/c2pa-rs/releases) or `cargo install c2patool`) and have it on `PATH`. Details in [docs/production.md](./docs/production.md).

## Quickstart

See [QUICKSTART.md](./QUICKSTART.md) — from clone to your first persisted, hash-only, tamper-evident evidence record in under 15 minutes, with or without a model API key. ([Tamper-evident](./docs/production.md) means detectable, not prevented.)

**Interactive demo (local, keyless):** `pnpm demo` starts a web demo of both pipelines — paste text to get a hash-only evidence record (hashed in your browser; the text never leaves the page), or upload a PNG/JPEG to get it C2PA-signed with the bundled dev certificates, plus a rendered audit-report sample. See the [demo section in QUICKSTART.md](./QUICKSTART.md#run-the-interactive-demo-under-5-minutes-keyless). The demo is local-run until the public launch.

## What is implemented today

The text evidence pipeline, the evidence store, C2PA image signing, the disclosure UI kit, audit export, and the interactive demo:

| Package | What it does |
| --- | --- |
| `@gsengai/core` | Append-only, hash-chained SQLite evidence store; SHA-256 text fingerprinting (raw + normalized); detection lookups; audit exports — streaming JSONL and CSV, plus a human-readable Markdown audit report (`buildAuditReport`, `gsengai-audit` CLI) that surfaces chain integrity prominently. Hashes and metadata only — raw prompts/outputs never persist, in the store or in any export. |
| `@gsengai/openai` | `withEvidence(client)` wrapper for the OpenAI Node SDK — `chat.completions.create` and `responses.create`, streaming and non-streaming. |
| `@gsengai/anthropic` | `withEvidence(client)` wrapper for the Anthropic TypeScript SDK — `messages.create` (stream + non-stream) and the `messages.stream()` helper. |
| `@gsengai/ai-sdk` | `evidenceMiddleware()` — a `LanguageModelMiddleware` for the Vercel AI SDK (`ai@7`) via `wrapLanguageModel`. |
| `@gsengai/c2pa` | `createImageSigner(...)` — signs PNG/JPEG with C2PA manifests declaring AI generation, preserves pre-existing manifests as chained ingredients (never overwrites), writes an evidence record per signing. Dev certificates bundled for integration testing; see [docs/CERTIFICATES.md](./docs/CERTIFICATES.md). |
| `@gsengai/disclosure` | Article 50 disclosure UI kit: `<AIInteractionNotice/>`, `<AIGeneratedBadge/>`, `<SyntheticContentLabel/>` as React components **and** plain-HTML string functions, localized EN/DE/FR, bundling the official EU transparency icons with full provenance. Zero runtime dependencies; see [docs/DISCLOSURE.md](./docs/DISCLOSURE.md). |

Wrappers never mutate or block model responses: they hash the generated text in memory, append an evidence record, and return the SDK's response unmodified. Failure semantics default to fail-open with a loud warning and a lost-record counter; `failMode: 'strict'` is opt-in.

**Know what is and is not captured:** [docs/capture-coverage.md](./docs/capture-coverage.md) documents the capture gaps and semantics (`n > 1`, `Stream.tee()`, `.withResponse()`, `MessageStream` observation, the lost-record counter, exact-match lookup semantics — edited text will not match, though the generation-time audit trail is unaffected) — read it before relying on the evidence log.

**Audit artifacts:** `store.exportCsv(path, filter?)` and `store.buildAuditReport({ path, filter })` (or the `gsengai-audit` CLI) turn the evidence log into the documents a team hands its counsel or a supervisory authority: a CSV of all records and a Markdown audit report with an Integrity section (`verifyChain()` outcome — verified or BROKEN — always reported, never suppressed), summary breakdowns, the full record listing, and the limits block above. See [QUICKSTART.md](./QUICKSTART.md#export-audit-artifacts-csv--audit-report-under-5-minutes).

The HTTP detection endpoint arrives in a later release (see [ROADMAP.md](./ROADMAP.md)).

## Production

Taking this to real users involves choices this README does not make for you: signing certificates, evidence-store topology across multiple instances, and how the wrappers should behave when the store is unavailable. See [docs/production.md](./docs/production.md).

## About the name

The name combines the Bavarian *gseng* — "seen" — with AI. The project helps teams make AI-system behavior, disclosures, labels, and evidence visible.

There is also a quiet nod to [Sengai Gibon](https://en.wikipedia.org/wiki/Sengai), whose ink drawings made complex ideas simple and light.

## Built with

Fittingly for a project about AI transparency: this was built with [Claude Code](https://claude.com/claude-code), Anthropic's agentic coding tool. The bulk of the implementation was done with Claude Fable 5, and the release engineering with Claude Opus 4.8. Design decisions, review, and direction are the maintainer's.

## License

Apache-2.0
