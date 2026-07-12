# @gsengai/ai-sdk

`LanguageModelMiddleware` for the Vercel AI SDK (`ai@7`) that logs a hash-only evidence record per text generation, streaming and non-streaming. Supports compliance with **EU AI Act Article 50** and **California SB 942**.

Part of [gsengai](https://github.com/gsengai/gsengai), open-source transparency and provenance tooling for AI product teams.

## Install

```sh
pnpm add @gsengai/ai-sdk @gsengai/core
```

Requires Node ≥ 22 and `ai@7`.

## Usage

```ts
import { wrapLanguageModel } from "ai";
import { createEvidenceStore } from "@gsengai/core";
import { evidenceMiddleware } from "@gsengai/ai-sdk";

const store = createEvidenceStore({ path: "./evidence.db" });

const model = wrapLanguageModel({
  model: yourModel, // any ai@7 language model
  middleware: evidenceMiddleware({ store, systemId: "my-feature" }),
});

// Use `model` with generateText / streamText as usual — every text generation
// is fingerprinted (SHA-256, raw + normalized) and appended to the evidence log.
```

**The middleware never mutates or blocks model responses.** It hashes the generated text in memory, appends a hash-only evidence record, and passes the result through unmodified. If the store fails, the default is fail-open: the response is still returned, a loud warning is logged, and `getLostRecordCount()` increments — `failMode: 'strict'` opts into throwing instead.

## Documentation

- [Quickstart](https://github.com/gsengai/gsengai/blob/main/QUICKSTART.md)
- [Capture coverage](https://github.com/gsengai/gsengai/blob/main/docs/capture-coverage.md) — exactly what is and is not logged

## Positioning

This package supports compliance with EU AI Act Article 50 and California SB 942. It does not make you compliant — compliance depends on your system, your deployment context, and your processes. It is not legal advice.

## License

Apache-2.0
