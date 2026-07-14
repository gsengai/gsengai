# Capture coverage & semantics

The text wrappers capture the overwhelmingly common paths, but not every way
an SDK response can be consumed. These are user-facing limits of the current
implementation — read them before relying on the evidence log for a path your
code uses. None of this changes what wrappers never do: they never mutate or
block a model response.

## Multiple choices per call (OpenAI `n > 1`)

One evidence record is appended **per text-bearing choice**, in choice-index
order, for both streaming and non-streaming chat completions. A call with
`n: 3` yields three records — each delivered text is individually matchable by
`findByText`/`findByOutputHash`. The common `n: 1` case yields exactly one
record.

## OpenAI `Stream.tee()` and `toReadableStream()` bypass recording

The streaming wrapper records by observing async iteration of the stream it
returns. `tee()` splits the *underlying* stream into two new streams that do
not pass through the wrapper, and `toReadableStream()` detaches consumption
the same way: **text consumed through either is not recorded at all** — not
once, not twice. If you `tee()`, record one branch yourself or avoid `tee()`
on wrapped clients. (Characterized against mocks; `examples/smoke-live.ts`
includes a live probe for this path.)

## `failMode: 'strict'` and streaming return derived promises

In the default fail-open mode, non-streaming calls return the SDK's original
promise untouched — OpenAI `APIPromise` helpers like `.withResponse()` keep
working. In `strict` mode, and on all streaming calls, the wrapper returns a
**derived promise** so evidence failures can surface: the resolved values are
identical, but `APIPromise`-specific helpers (`.withResponse()`,
`.asResponse()`) are not available on the returned promise.

## Anthropic `MessageStream` is observed, never proxied

`messages.stream()` returns the SDK's own `MessageStream` instance with
evidence listeners attached (the class uses private fields and cannot be
proxied safely). Consequences: the object identity is the SDK's; evidence
recording rides on the stream's `text`/`end`/`error`/`abort` events; in
`strict` mode an evidence failure inside those listeners cannot reject your
original call — it is reported through the stream's error path instead.

## Fail-open losses are counted, not silent

When the evidence store fails in fail-open mode, the model response is still
returned, a loud `[gsengai]` warning is logged, and a process-wide counter
increments. Watch it via `getLostRecordCount()` from `@gsengai/core` (and
`resetLostRecordCount()` for metrics scrapers). A non-zero counter means your
evidence log has gaps for exactly that many generations.

## Text lookups are exact-match — edited text will not match

`findByText` / `findByOutputHash` answer "did we generate exactly this
text?". The store keeps two SHA-256 fingerprints per output: the raw text
and a normalized form (Unicode NFC, lowercased, whitespace collapsed —
spec §5). Lookups therefore tolerate case, whitespace, and
Unicode-encoding differences — and nothing else. Change one word, add a
comma, or paraphrase a sentence, and the lookup returns no match.

Two consequences worth keeping apart:

- **The audit trail is unaffected.** An evidence record documents what was
  generated at generation time; editing a downstream copy of the text does
  not touch the store, and `verifyChain()` still passes.
- **Reverse tracing is lost.** Given an edited copy found in the wild, the
  store cannot connect it back to the original record. This is a direct
  consequence of the privacy design: raw text never persists, so there is
  nothing to fuzzy-search at query time. Similarity matching over
  write-time fingerprints (shingle / MinHash) is on the
  [roadmap](../ROADMAP.md).

## Media signing (`@gsengai/c2pa`)

Every successful `signImage` writes one evidence record for the **signed
output bytes**. Signing failures throw and write nothing — there is no signed
asset to evidence. Only PNG and JPEG are supported in the MVP; manifests do
not survive re-encoding (see [CERTIFICATES.md](./CERTIFICATES.md)).

---

> **What this does NOT do**
>
> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.
> - It does not embed imperceptible watermarks (MVP). It implements the signed-metadata and logging/fingerprinting layers of a multi-layer marking strategy.
> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.
> - It does not detect third-party AI content.
> - It is not legal advice. Consult qualified counsel about your obligations.
