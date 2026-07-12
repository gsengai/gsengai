# @gsengai/core

Append-only, hash-chained evidence store for AI transparency obligations — SHA-256 text fingerprinting, detection lookups, and audit exports (JSONL, CSV, Markdown audit report + `gsengai-audit` CLI). Supports compliance with **EU AI Act Article 50** and **California SB 942**.

**Hashes and metadata only** — raw prompts and outputs never persist, in the store or in any export. Enforced by a canary test.

Part of [gsengai](https://github.com/gsengai/gsengai), open-source transparency and provenance tooling for AI product teams.

## Install

```sh
pnpm add @gsengai/core
```

Requires Node ≥ 22.

## Usage

```ts
import { createEvidenceStore } from "@gsengai/core";

const store = createEvidenceStore({ path: "./evidence.db" });

// Append a hash-only evidence record for a model text output
const record = store.append({
  modality: "text",
  model: "gpt-4o-mini",
  systemId: "my-feature",
  outputText: generatedText, // hashed in memory — the raw text never touches disk
});

store.verifyChain();                        // { ok: true, checked: n } — tamper-evident
store.findByText(suspectText);              // detection lookup by content hash
store.exportJsonl("./evidence-export.jsonl");
store.buildAuditReport({ path: "./audit-report.md" }); // hand-to-counsel Markdown report
```

Every record carries `prev_hash` and `record_hash`, so edits, deletions, and splices are detectable (`verifyChain()` reports the first break — detectable, not prevented). There is no update or delete API by design.

Most apps don't call `append` directly — the SDK wrappers do it automatically: [@gsengai/openai](https://www.npmjs.com/package/@gsengai/openai), [@gsengai/anthropic](https://www.npmjs.com/package/@gsengai/anthropic), [@gsengai/ai-sdk](https://www.npmjs.com/package/@gsengai/ai-sdk).

## Documentation

- [Quickstart](https://github.com/gsengai/gsengai/blob/main/QUICKSTART.md) — first evidence record in under 15 minutes, keyless
- [Capture coverage](https://github.com/gsengai/gsengai/blob/main/docs/capture-coverage.md) — exactly what is and is not logged
- [Production notes](https://github.com/gsengai/gsengai/blob/main/docs/production.md) — store topology, failure behavior

## Positioning

This package supports compliance with EU AI Act Article 50 and California SB 942. It does not make you compliant — compliance depends on your system, your deployment context, and your processes. It is not legal advice.

## License

Apache-2.0
