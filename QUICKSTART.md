# Quickstart — first evidence record in under 15 minutes

This walkthrough supports compliance with EU AI Act Article 50 and California SB 942 by logging and fingerprinting model text outputs — hashes and metadata only. The default path needs **no API key and makes no network calls** (after install).

It runs from a clone of this repository, exercising the bundled examples and demo. To add gsengai to **your own app** instead, install the published packages from npm (`pnpm add @gsengai/core` plus the wrappers you need — see the [README](./README.md#install)) and jump to [Wire it into your own app](#wire-it-into-your-own-app).

## Prerequisites

1. Node.js ≥ 22 — check with `node --version`
2. pnpm ≥ 9 — if missing: `corepack enable` (ships with Node)

## Keyless path (default)

3. Clone the repository:

   ```sh
   git clone https://github.com/gsengai/gsengai.git
   cd gsengai
   ```

4. Install dependencies (the only other step that touches the network):

   ```sh
   pnpm install
   ```

5. Run the test suite — every capture path is covered, and no test touches the network:

   ```sh
   pnpm test
   ```

6. Build the packages:

   ```sh
   pnpm build
   ```

7. Run the quickstart:

   ```sh
   pnpm quickstart
   ```

   It wraps a built-in mock OpenAI-shaped client with `withEvidence(...)`, then:
   - hashes the generated text (SHA-256 of the raw text + of the normalized text),
   - appends a tamper-evident evidence record ([detectable, not prevented](./docs/production.md)) to `examples/.out/evidence.db`,
   - verifies the hash chain,
   - exports the log as JSONL to `examples/.out/evidence-export.jsonl` — the audit artifact.

8. Read the printed record: it contains hashes and metadata only. The raw model output never touches disk — that is the privacy default, enforced by a canary test.

## With a real API key (optional)

```sh
export OPENAI_API_KEY=sk-...
pnpm quickstart              # same flow, live API (model: gpt-4o-mini)
GSENGAI_QUICKSTART_MODEL=gpt-4.1 pnpm quickstart   # pick another model
```

## Sign an AI-generated image (keyless, dev certificates)

`@gsengai/c2pa` signs PNG/JPEG images with a C2PA manifest declaring AI
generation. No API key needed — this works on any local image.

> **Platform note:** on macOS (Apple Silicon) signing works with no extra
> setup. On Linux, Windows, and Intel macs, install
> [c2patool](https://github.com/contentauth/c2pa-rs/tree/main/cli) once
> ([prebuilt binaries](https://github.com/contentauth/c2pa-rs/releases) or
> `cargo install c2patool`) and have it on `PATH` — the fallback backend is
> auto-detected. Details in [docs/production.md](./docs/production.md).

```ts
import { createEvidenceStore } from "@gsengai/core";
import { createImageSigner, readManifest } from "@gsengai/c2pa";

const store = createEvidenceStore({ path: "./evidence.db" });
const signer = createImageSigner({ store, systemId: "my-image-feature" });
// ⚠ no certPath/keyPath given → bundled DEV certificates + a one-time warning

const { record, manifestLabel } = await signer.signImage({
  input: "./generated.png",
  output: "./generated.signed.png",
  model: "gpt-image-1",
});
console.log(record);        // evidence record: modality 'image', marking ['c2pa']

// Verify locally: manifest label, ingredient chain, exact validation codes
console.log(await readManifest("./generated.signed.png"));
```

You can also drop `generated.signed.png` onto
[contentcredentials.org/verify](https://contentcredentials.org/verify) to inspect
the manifest — it will show the AI-generation metadata but flag the credential
as untrusted, because dev-cert-signed manifests fail public trust validation
by design and are for integration testing only (see
[docs/CERTIFICATES.md](./docs/CERTIFICATES.md) for the production certificate
path).

If the input image already carries a C2PA manifest, `signImage` never
overwrites it: the existing manifest is chained as the parent ingredient and
stays resolvable in the signed output.

## Disclose the AI interaction to your users (under 5 minutes)

`@gsengai/disclosure` renders the Article 50 user-facing notices. In a React app:

```tsx
import { AIInteractionNotice, AIGeneratedBadge } from "@gsengai/disclosure";
import "@gsengai/disclosure/disclosure.css";

export function Chat() {
  return (
    <>
      <AIInteractionNotice />              {/* "You are interacting with an AI system." */}
      {/* ...your chat UI... */}
      <AIGeneratedBadge variant="generated" /> {/* official EU icon + "Fully AI-generated" */}
    </>
  );
}
```

`locale="de"` / `locale="fr"` switch the copy ("KI" / "IA"). The badge bundles the official
EU transparency icons published with the Code of Practice on marking and labelling of
AI-generated content — read the caveats in [docs/DISCLOSURE.md](./docs/DISCLOSURE.md)
before shipping them.

Not using React? The same components exist as plain-HTML string functions:

```ts
import { interactionNoticeHTML } from "@gsengai/disclosure/html";

const html = interactionNoticeHTML({ locale: "fr" });
// <div class="gsengai-disclosure gsengai-interaction-notice" role="note" aria-label="…">…</div>
```

Serve `@gsengai/disclosure/disclosure.css` alongside — one stylesheet styles both entries.

## Export audit artifacts (CSV + audit report, under 5 minutes)

Turn the evidence log into the two audit artifacts — a CSV of all records and a
human-readable Markdown audit report (integrity, summary, record listing, limits):

```sh
pnpm audit-export
```

This seeds a demo store and writes `examples/.out/audit-export.csv` and
`examples/.out/audit-report.md` — keyless, offline. Open the report: the
Integrity section states the `verifyChain()` outcome up front (verified, or
**BROKEN at seq N** — a break is always reported, never suppressed), followed by
summary breakdowns and every record's hashes and metadata. No export contains
raw content — the hashes-only privacy default extends to exports, enforced by a
canary test.

Against your own store, use the same functions or the bundled `gsengai-audit` CLI:

```sh
pnpm --filter @gsengai/core build   # once; provides dist/ for the bin
node packages/core/dist/gsengai-audit.js export \
  --store ./evidence.db --format report --out ./audit-report.md
node packages/core/dist/gsengai-audit.js export \
  --store ./evidence.db --format csv --out ./audit-export.csv \
  --system-id my-feature --since 2026-07-01T00:00:00Z --until 2026-08-01T00:00:00Z
```

Optional filters (`--system-id`, `--modality`, `--since`, `--until`) narrow both
formats; the default is the full store. Chain verification always covers the
entire store, even when a filter is applied.

**Hand it to counsel:** the report is Markdown by design (portable, diff-able).
Rendering the report Markdown to PDF or HTML is your step, with any tool you
already use — e.g. `pandoc audit-report.md -o audit-report.pdf`.

## Run the interactive demo (under 5 minutes, keyless)

One command builds the packages the demo needs and starts it locally:

```sh
pnpm demo
```

Open http://localhost:3000 and try both flows:

- **Text:** paste any text — it is hashed **in your browser** (Web Crypto; the
  raw text never leaves the page) and the server appends a hash-only §4
  evidence record to a request-scoped in-memory store, returning the record and
  the chain-verification result.
- **Image:** upload a PNG/JPEG — the server signs it with a C2PA manifest (the
  bundled dev certificates), returns the signed file for download plus the
  manifest summary, and links to
  [contentcredentials.org/verify](https://contentcredentials.org/verify). The
  verifier will flag the issuer as untrusted — expected for dev certificates;
  the page says so before you click through. On platforms other than macOS
  (Apple Silicon) the image flow needs `c2patool` installed — see the platform
  note above; the text flow runs everywhere with no extra setup.

Nothing you enter is persisted: the demo store is in-memory, hash-only, and
wiped after every request. The demo also renders a live
[audit report sample](http://localhost:3000/audit-report-sample) — the
Markdown audit report rendered to HTML.

The demo runs locally only for now; public deployment is prepared (see
`apps/demo/DEPLOY.md`) but gated on the product name lock.

## Wire it into your own app

```ts
import OpenAI from "openai";
import { createEvidenceStore } from "@gsengai/core";
import { withEvidence } from "@gsengai/openai";

const store = createEvidenceStore({ path: "./evidence.db" });
const client = withEvidence(new OpenAI(), { store, systemId: "my-feature" });
// Use `client` exactly as before — every text generation is fingerprinted.
// Later: store.findByText(suspectText), store.verifyChain(), store.exportJsonl(path)
```

Same pattern for the other SDKs:

- Anthropic: `withEvidence(new Anthropic(), { store, systemId })` from `@gsengai/anthropic`
- Vercel AI SDK: `wrapLanguageModel({ model, middleware: evidenceMiddleware({ store, systemId }) })` from `@gsengai/ai-sdk`

Wrappers never mutate or block model responses. If the evidence store fails, the default is fail-open: the response is still returned, a loud warning is logged, and the lost-record counter (`getLostRecordCount()`) increments. Opt into `failMode: 'strict'` to throw instead.

---

> **What this does NOT do**
>
> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.
> - It does not embed imperceptible watermarks (MVP). It implements the signed-metadata and logging/fingerprinting layers of a multi-layer marking strategy.
> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.
> - It does not detect third-party AI content.
> - It is not legal advice. Consult qualified counsel about your obligations.
