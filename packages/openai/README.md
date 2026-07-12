# @gsengai/openai

Drop-in wrapper for the OpenAI Node SDK that logs a hash-only evidence record per text generation — `chat.completions.create` and `responses.create`, streaming and non-streaming. Supports compliance with **EU AI Act Article 50** and **California SB 942**.

Part of [gsengai](https://github.com/gsengai/gsengai), open-source transparency and provenance tooling for AI product teams.

## Install

```sh
pnpm add @gsengai/openai @gsengai/core
```

Requires Node ≥ 22.

## Usage

```ts
import OpenAI from "openai";
import { createEvidenceStore } from "@gsengai/core";
import { withEvidence } from "@gsengai/openai";

const store = createEvidenceStore({ path: "./evidence.db" });
const client = withEvidence(new OpenAI(), { store, systemId: "my-feature" });

// Use `client` exactly as before — every text generation is fingerprinted
// (SHA-256, raw + normalized) and appended to the tamper-evident evidence log.
```

**The wrapper never mutates or blocks model responses.** It hashes the generated text in memory, appends a hash-only evidence record, and returns the SDK's response unmodified. If the store fails, the default is fail-open: the response is still returned, a loud warning is logged, and `getLostRecordCount()` increments — `failMode: 'strict'` opts into throwing instead.

## Documentation

- [Quickstart](https://github.com/gsengai/gsengai/blob/main/QUICKSTART.md) — runs keyless against a mock client
- [Capture coverage](https://github.com/gsengai/gsengai/blob/main/docs/capture-coverage.md) — read this before relying on the evidence log (`n > 1`, `Stream.tee()`, `.withResponse()` semantics)

## Positioning

This package supports compliance with EU AI Act Article 50 and California SB 942. It does not make you compliant — compliance depends on your system, your deployment context, and your processes. It is not legal advice.

## License

Apache-2.0
