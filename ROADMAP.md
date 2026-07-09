# Roadmap

This project provides the technical marking and logging layer that supports compliance with EU AI Act Article 50 and California SB 942. It does not make you compliant and is not legal advice.

The roadmap below is a set of directions, not dated commitments. Priorities shift with what people actually need, so the best signal is an issue describing your use case.

## Available today (v0.1)

- Append-only, hash-chained evidence store (SQLite) with JSONL, CSV, and Markdown audit-report exports, and the `gsengai-audit` CLI.
- Text output logging and fingerprinting through wrappers for the OpenAI, Anthropic, and Vercel AI SDKs. The model response is returned unmodified; fail-open by default.
- C2PA signing for PNG and JPEG, preserving any existing manifest as a chained ingredient.
- A disclosure UI kit (React and plain HTML) with the official EU transparency icons in English, German, and French.

## Near-term

- Cross-platform C2PA signing — a `c2patool` fallback so image signing runs on Linux and Windows, not only macOS on Apple Silicon (a limitation of the current `@contentauth/c2pa-node` build).
- Publish the packages to npm so they can be installed without building from source.
- A public hosted version of the interactive demo (it runs locally today).

## Under consideration

Nothing here is promised or scheduled.

- Back-compatibility for older Vercel AI SDK majors (`ai@5`, `ai@6`).
- C2PA manifests for audio and video, building on the existing image support.
- An optional HTTP detection endpoint over the existing `findByOutputHash` / `findByText` lookups.
- Wider integration coverage: LangChain and LlamaIndex callbacks, a Python SDK, and an MCP server exposing mark/verify operations.
- Similarity matching (shingle / MinHash) so lightly edited text can still be traced to a logged output.
- Optional encrypted raw-content capture, off by default, for teams whose own policies require retaining content.
- Additional disclosure-kit localizations beyond English, German, and French.
- A gateway / reverse-proxy mode for logging without code changes.
- Signing with keys held in a KMS or HSM, rather than read from files, for production key handling.
- A shared evidence-store mode, or additional storage backends, for deployments that run across several instances (the default store is a single-writer SQLite file).
- Optional trusted timestamping (RFC 3161) or external anchoring, to strengthen the evidence chain beyond detecting casual and accidental tampering.

## Not planned

To keep the project honest about what it is:

- Making you "compliant," or any form of legal advice or certification. Compliance depends on your system, deployment, and processes.
- Imperceptible watermarking of text. Robust text watermarking is not a solved problem; this project implements the logging and fingerprinting fallback instead.
- Detecting third-party AI content. The tools mark and log what you generate.
- Preventing downstream metadata stripping. Manifests can be removed by re-encoding, screenshots, or platform re-uploads, which is exactly why the logging layer exists.
