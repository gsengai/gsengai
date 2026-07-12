# DECISIONS.md — Architecture Decision Records

ADR format (from CLAUDE.md):

```
ADR-NNNN · YYYY-MM-DD · title
Context: …
Decision: …
Consequences: …
Discovery signal: … (required when scope-affecting)
```

---

ADR-0001 · 2026-07-06 · pnpm workspaces monorepo layout
Context: WP1 ships one evidence core plus three SDK wrappers that must version, test, and build together.
Decision: pnpm workspaces monorepo with `packages/core`, `packages/openai`, `packages/anthropic`, `packages/ai-sdk` (scoped `@gsengai/*`; all packages `private: true` under the publish embargo).
Consequences: One install/test/build pipeline; wrappers depend on `@gsengai/core` via `workspace:^`; lifting the embargo later is a packaging change, not a restructuring.
Discovery signal: n/a — prescribed by WP1.

ADR-0002 · 2026-07-06 · tamper-evident hash chain on the append-only store
Context: Evidence is only audit-worthy if tampering is detectable (PRD §4, C2).
Decision: Each record carries `prev_hash` (the previous record's `record_hash`; null for genesis) and `record_hash = sha256(canonicalJson(all other fields))`. `verifyChain()` walks the log in `seq` order, recomputes every hash, checks linkage, and reports the first break as `brokenAtSeq`.
Consequences: Edits, deletions, forged rows, and splices are all detectable; ordering is anchored by SQLite `seq`, integrity by the hashes.
Discovery signal: n/a — prescribed by WP1.

ADR-0003 · 2026-07-06 · better-sqlite3 as the storage engine
Context: The store needs a battle-tested single-file database; `node:sqlite` is still experimental on Node 22.
Decision: `better-sqlite3` (^12) is the sole runtime dependency of `@gsengai/core`. WAL journal mode; appends run in an immediate transaction (read chain head + insert atomically).
Consequences: Synchronous writes make wrapper recording deterministic (a record is persisted before the caller's `await` resumes); native prebuilds cover common platforms.
Discovery signal: n/a — prescribed by WP1.

ADR-0004 · 2026-07-06 · wrapper failure semantics: fail-open default, strict opt-in
Context: PRD A3 — evidence capture must never take down production model calls.
Decision: Default fail-open: any evidence failure logs a loud `[gsengai]` warning via `console.warn`, increments a lost-record counter, and the model response is still returned. `failMode: 'strict'` throws instead.
Consequences: Evidence loss is visible (counter + warning) without breaking callers; teams with hard evidence requirements opt into strict.
Discovery signal: n/a — prescribed by WP1.

ADR-0005 · 2026-07-06 · Vercel AI SDK target ai@^7
Context: WP1 pins `ai@^7` (v7.0.15 resolved at install); `ai@5`/`ai@6` back-compat is P1.
Decision: `@gsengai/ai-sdk` ships a `LanguageModelMiddleware` (provider spec v4 in ai@7) implementing `wrapGenerate` and `wrapStream`, used through `wrapLanguageModel`.
Consequences: `wrapLanguageModel` upgrades V2/V3 models to V4 internally, so the middleware also covers older-spec models wrapped through ai@7.
Discovery signal: n/a — prescribed by WP1.

ADR-0006 · 2026-07-06 · storeRawContent throws NotImplemented; hash-only privacy default
Context: PRD C4 — only hashes and metadata persist in the MVP.
Decision: `storeRawContent` exists in `CreateEvidenceStoreOptions` but `createEvidenceStore` throws `NotImplementedError` when it is set. Encrypted raw capture is P1. A canary test asserts that sentinel output/prompt text never appears in the DB, WAL, or SHM file bytes.
Consequences: No code path can persist raw content; the canary test is protected by CLAUDE.md non-negotiable #3 (never deleted, skipped, or weakened).
Discovery signal: n/a — prescribed by WP1.

ADR-0007 · 2026-07-06 · tsup dual ESM/CJS build; TypeScript strict; Node ≥ 22
Context: PRD §8 requires ESM + CJS delivery on Node ≥ 22 with strict TypeScript.
Decision: tsup builds esm + cjs + d.ts/d.cts per package; a shared strict tsconfig (including `noUncheckedIndexedAccess`) is extended by every package; `engines.node >= 22` everywhere.
Consequences: One build tool, per-condition types in `exports`; tests run against sources via vitest aliases so `pnpm test` needs no prior build.
Discovery signal: n/a — prescribed by WP1.

ADR-0008 · 2026-07-06 · record ids via crypto.randomUUID(); ordering via SQLite seq
Context: Records need stable ids and a total order without coupling the §4 schema to storage details.
Decision: `id = crypto.randomUUID()`; ordering comes from `seq INTEGER PRIMARY KEY`, which is storage-level and not part of the §4 record (and therefore not hashed). Core runtime dependencies stay limited to `better-sqlite3`.
Consequences: Exported records are §4-pure; chain order is still externally reconstructible from `prev_hash` linkage.
Discovery signal: n/a — prescribed by WP1.

ADR-0009 · 2026-07-06 · Biome as the single linter/formatter
Context: WP1 offers eslint+prettier or biome, with an ADR required if biome is chosen.
Decision: Biome 2 (`biome check`) provides linting, formatting, and import organizing in one dev dependency with sub-second runs.
Consequences: Fewer moving parts than eslint+prettier; the ESLint plugin ecosystem is unavailable, which is acceptable at MVP scope.
Discovery signal: n/a — tooling choice within the options WP1 offers.

ADR-0010 · 2026-07-06 · one evidence record per text-bearing choice (OpenAI n > 1)
Context: PRD A2 says "per generation … append one evidence record", and detection (`findByText`) must match the text a user actually received. An OpenAI chat call with `n > 1` returns several generated texts.
Decision: The OpenAI wrapper appends one record per text-bearing choice, in choice-index order, for both non-streaming and streaming calls. The common n=1 case yields exactly one record. Anthropic messages, AI SDK results, and Responses API responses are single generations → single record (Responses output text parts are concatenated, as the SDK's own `output_text` does).
Consequences: Record count equals delivered generations; every delivered text is individually matchable by hash.
Discovery signal: n/a — interpretation of PRD A2 within WP1 scope.

ADR-0011 · 2026-07-06 · wrapper return-path semantics (never mutate, never block)
Context: PRD A3. SDK return values carry extra API surface (OpenAI `APIPromise.withResponse()`, stream classes with `tee()`, Anthropic `MessageStream` with private fields) that a wrapper must not break.
Decision: (a) Non-streaming calls in fail-open mode return the SDK's original promise untouched; recording happens through a side subscription that runs before the caller's continuation (better-sqlite3 appends are synchronous). (b) Strict mode returns a derived promise so evidence failures can reject. (c) Streaming calls return a derived promise resolving to a Proxy-wrapped stream that passes every value through unmodified and finalizes exactly once on completion, error, abort, or early break; proxied methods are bound to the underlying stream so private-field classes keep working. (d) `messages.stream()` returns the SDK's own MessageStream instance with listeners attached — never proxied, because the class uses private fields. (e) Consumers that bypass async iteration (`tee()`, `toReadableStream()`) bypass recording.
Consequences: The default path is a true pass-through. In strict mode and on streaming paths, promise identity changes (resolved values do not). The tee/toReadableStream gap and strict-mode error surfacing inside event-driven streams are documented P1 refinements.
Discovery signal: n/a — implementation semantics within WP1 scope.

ADR-0012 · 2026-07-06 · process-wide lost-record counter lives in core
Context: PRD A3 requires a lost-record counter, but wrappers live in three packages.
Decision: The counter lives in `@gsengai/core` (`getLostRecordCount()` / `resetLostRecordCount()`), shared by all wrappers through `safeAppend`, which also owns the loud `[gsengai]` warning.
Consequences: One process-wide number to watch or scrape; per-store counters can be added later without breaking the API.
Discovery signal: n/a.

ADR-0013 · 2026-07-06 · store exposes close()
Context: WP1's store surface does not list `close()`, but the canary test must read raw DB bytes after a deterministic release of the file, and server shutdown paths need it too.
Decision: `EvidenceStore.close()` closes the SQLite handle. No other lifecycle methods.
Consequences: None for the append-only guarantees.
Discovery signal: n/a — required by WP1's own canary test design.

ADR-0014 · 2026-07-06 · signing backend: @contentauth/c2pa-node@0.6.0, pinned exact
Context: PRD B5 requires a signing-backend verification gate at WP2 start. The old `c2pa-node` npm package is officially deprecated; its successor `@contentauth/c2pa-node` 0.6.0 (published 2026-06-18, c2pa-js monorepo, prebuilt binaries, engines node >=22) is pre-1.0. `c2patool` 0.26.68 stood by as shell-out fallback. WP2 prescribed a 2-hour smoke gate: dev-cert sign → Reader read round-trip on a test PNG.
Decision: Smoke gate passed well inside the box (file and buffer paths, PNG and JPEG, create and edit intents, offline settings). `@contentauth/c2pa-node` is the backend, pinned exact at 0.6.0 because it is pre-1.0 and its API may move. `c2patool` shell-out remains documented future work, not implemented.
Consequences: Native prebuilt binaries (Linux x64/arm64, macOS x64/arm64, Windows) install via a postinstall script — added to pnpm `onlyBuiltDependencies`. Version bumps are deliberate acts with a re-run of the signing test suite.
Discovery signal: n/a — gate prescribed by WP2; outcome recorded.

ADR-0015 · 2026-07-06 · intent mapping: create + trainedAlgorithmicMedia vs edit + parent ingredient
Context: PRD B3 — never overwrite an existing manifest, always chain it. The backend's builder intents map exactly onto this: `create` requires a digitalSourceType and forbids a parent; `edit` requires a parent ingredient and generates it from the source stream.
Decision: Input without an existing manifest → intent `create` with `digitalSourceType: http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia` (auto `c2pa.created` action). Input with an existing manifest (detected via `Reader.fromAsset`, which returns null for unsigned assets) → intent `edit`; the builder generates the parentOf ingredient and the `c2pa.opened` action tied to it. The original manifest label stays resolvable in the signed output's manifest store (test-enforced).
Consequences: Provenance chains grow monotonically; a re-signed asset carries chain length 2 with ingredient count 1. AI-edited-input semantics (an AI edit of a signed asset) are represented as `opened`, not `created` — honest per the C2PA action vocabulary.
Discovery signal: n/a — prescribed by WP2.

ADR-0016 · 2026-07-06 · dev certificates: committed self-signed ES256 chain + one-time warning
Context: PRD B4 — bundled dev certs for zero-friction integration testing; production certs documented, never bundled.
Decision: `scripts/gen-dev-certs.sh` (openssl) generates a self-signed P-256 root CA plus an ES256 leaf with the C2PA claim-signing profile (critical digitalSignature key usage, emailProtection EKU, CA:FALSE). A pregenerated pair is committed under `packages/c2pa/dev-certs/` with a README warning block; the private key is deliberately public. `createImageSigner` defaults to these files and prints a one-time stderr warning naming them untrusted and integration-only. `docs/CERTIFICATES.md` documents the production path (CA-issued C2PA-conformant cert, KMS/HSM key storage, conformance-program pointer).
Consequences: Quickstart signs keylessly in minutes; nobody can mistake dev-signed output for trusted output — validators report `signingCredential.untrusted` and our own `readManifest` reports the same codes.
Discovery signal: n/a — prescribed by WP2.

ADR-0017 · 2026-07-06 · failure semantics: signing always throws; evidence follows failMode
Context: PRD A3's fail-open applies to evidence capture around a successful model response. Signing is not capture — it is the operation itself; there is no asset to return if it fails.
Decision: Any failure up to and including producing + re-reading the signed asset throws, regardless of `failMode` (corrupt input, unsupported format, signer errors). The subsequent evidence append goes through `safeAppend`: `open` (default) warns loudly, increments the shared lost-record counter, and still returns `{ output, record: null, manifestLabel }`; `strict` throws.
Consequences: A returned signed asset is always a real signed asset; evidence-loss visibility is identical across text and media pipelines.
Discovery signal: n/a — prescribed by WP2.

ADR-0018 · 2026-07-06 · manifest_ref = active manifest label; output_hash = sha256 of signed bytes, computed in core
Context: The evidence record must let an auditor tie a signed file to its log entry byte-for-byte.
Decision: `manifest_ref` is the active manifest label of the signed output as reported by `Reader.activeLabel()` (read back after signing, not assumed). `output_hash` is the SHA-256 of the signed output bytes, computed centrally in `@gsengai/core` via the new `outputBytes` append input; `output_hash_normalized` is null for images; `hash_version` stays 1. Core hashes bytes in memory and never persists them (canary-extended for media).
Consequences: `findByOutputHash(sha256(file))` resolves any signed asset to its evidence record; hashing rules live in exactly one package.
Discovery signal: n/a — prescribed by WP2.

ADR-0019 · 2026-07-06 · generator/model info via org.gsengai.generator assertion (backend limits discovered by test)
Context: Two backend behaviors surfaced while implementing PRD B2's "generator/model info" assertions: (1) `@contentauth/c2pa-node` 0.6.0 rejects more than one `claim_generator_info` entry ("only 1 claim_generator_info allowed"), so the model cannot ride there next to the library entry; (2) adding an explicit `c2pa.opened` action on the edit path replaces the builder's auto-generated one and drops its ingredient reference, producing `assertion.action.ingredientMismatch` and an Invalid manifest.
Decision: `claim_generator_info` carries the single library entry (`gsengai-c2pa` + version). Model and timestamp are recorded (a) in the `c2pa.created` action (`softwareAgent`, `when`) on the create path only — the edit path keeps the builder's auto `c2pa.opened` untouched — and (b) uniformly on both paths in a custom `org.gsengai.generator` assertion `{ generator, model, when }`. The evidence record additionally persists the model.
Consequences: Manifests validate cleanly on both paths; consumers have one stable place (`org.gsengai.generator`) to read model info regardless of intent.
Discovery signal: backend validation errors above, reproduced in the test suite.

ADR-0020 · 2026-07-06 · bundle the official EU transparency icons with provenance
Context: PRD D4 gated icon bundling on verified usage terms. The gate cleared: the EU icons for labelling AI-generated content were published 2026-06-10 as Section 2 of the Code of Practice on marking and labelling of AI-generated content, "made publicly available for everyone to use freely, without the need for attribution"; verified against the live Commission page and downloaded from the Commission newsroom (SVG pack, document 129546) on 2026-07-06.
Decision: Bundle the 12 official SVGs (3 provenance variants × 4 colour treatments) under packages/disclosure/icons/ with PROVENANCE.md recording source URL, publication date, free-use terms, and per-file SHA-256 of the originals. Files stay byte-identical; only filenames are normalized (the pack's names contain spaces and a Commission-side "MOFIFIED" typo). Components default their icon slot to this set; the slot stays overridable (iconSvg). Docs state plainly that using the icons does not by itself establish compliance and that use by a non-signatory of the Code does not signal adherence to it.
Consequences: For inline rendering, scripts/gen-disclosure-icons.mjs derives src/icon-svgs.ts (strips XML declaration, prefixes internal CSS classes to prevent collisions between inlined icons, collapses whitespace); an integrity test pins every vector path of every inlined icon to the asset files. The verbatim SVGs are excluded from biome lint (they must not be edited to add <title>; a11y is handled at the rendering layer where icons are aria-hidden and always paired with text).
Discovery signal: PRD §10 open gate resolved by the Commission publication of 2026-06-10.

ADR-0021 · 2026-07-06 · badge variants map to the official icons; taxonomy is presentational
Context: The Code of Practice second draft removed the mandatory fully-generated vs AI-assisted distinction, but the official icon set still ships three provenance variants.
Decision: <AIGeneratedBadge/> exposes variant: 'generated' | 'modified' | 'basic' mapping to the three official icons (fully AI-generated / partially AI-modified / basic). Default is 'basic'. Docs frame the variant as an optional presentation choice, never a legal category or requirement.
Consequences: Integrators who adopted the earlier taxonomy keep a supported path; nobody is pushed into a distinction the Code no longer mandates.
Discovery signal: CoP second draft dropping the mandatory taxonomy (resolved before WP3, recorded here).

ADR-0022 · 2026-07-06 · @gsengai/disclosure package shape: React main entry + /html entry, zero runtime deps
Context: PRD D1/D2 require React components and framework-agnostic equivalents; positioning against script-tag competitors favors a dependency-free install.
Decision: @gsengai/disclosure ships React components at the main entry (peer dep react >= 18, marked optional so the /html entry installs cleanly without React) and @gsengai/disclosure/html exporting functions that return HTML strings, plus one shipped stylesheet (disclosure.css, exported as @gsengai/disclosure/disclosure.css from the package root). Zero runtime dependencies; icons as static assets (exported via ./icons/*); dual ESM/CJS per ADR-0007. Both entries consume one shared spec layer (src/spec.ts) and one string table (src/strings.ts), and the HTML output is verbatim-identical to the React static render, enforced by equivalence tests (the /html escaper mirrors React's & < > " ' set).
Consequences: One source of truth for markup and copy; the equivalence guarantee is structural, not aspirational. The stylesheet ships from the package root rather than dist so it exists identically in dev and published forms.
Discovery signal: n/a — prescribed by WP3.

ADR-0023 · 2026-07-06 · a11y baseline: role + accessible name, icon+text, never icon-only
Context: The CoP requires disclosures to be clear, distinguishable, accessible, recognizable without further interaction, and present at first interaction/exposure; Commission user-testing found icon-plus-text outperforms icon-only.
Decision: <AIInteractionNotice/> renders role="note" by default with an opt-in role="status" for notices injected at interaction start; every component carries an aria-label and always renders visible text (withIcon={false} exists, a text-less mode does not); icons are decorative (aria-hidden="true") and always paired with a text label; no focus traps; the four official colour treatments are exposed so integrators can keep contrast on any background. Components are documented as first-interaction/first-exposure renderable.
Consequences: An icon-only regression is a test failure, not a review comment; screen readers announce the disclosure text, never the SVG.
Discovery signal: n/a — prescribed by WP3.

ADR-0024 · 2026-07-07 · human-readable audit report format is Markdown
Context: PRD C3 requires a human-readable audit report — the artifact a company hands its counsel or a supervisory authority. Candidate formats: Markdown, HTML, PDF.
Decision: The report is a Markdown string (`buildAuditReport`), optionally written to a file. Zero new dependencies, portable, diff-able, and reviewable in any editor or git history. Rendering to PDF/HTML is the integrator's step, documented in QUICKSTART (e.g. pandoc); a bundled PDF/HTML renderer is P1.
Consequences: The report stays testable as plain text (positioning lint runs over the generated template); no rendering stack enters the dependency tree before launch.
Discovery signal: n/a — prescribed by WP4.

ADR-0025 · 2026-07-07 · the report always renders; integrity is reported, never suppressed and never thrown on
Context: `verifyChain()` can find a broken hash chain. An audit report that refuses to render — or quietly omits the break — would hide tampering exactly when the artifact matters most.
Decision: `buildAuditReport` never throws on a broken chain. The whole-store `verifyChain()` outcome is surfaced in a prominent Integrity section directly after the header: "Chain verified — N record(s) checked" or "⚠ BROKEN at seq N". The CLI additionally prints a stderr warning on a break. Verification always covers the entire store, independent of any export filter, and the report says so.
Consequences: A tampered store still yields a complete, honest report (test-enforced: forged row → report renders AND states BROKEN at the correct seq). Consumers must read the Integrity section — the record listing alone does not certify the chain.
Discovery signal: n/a — prescribed by WP4.

ADR-0026 · 2026-07-07 · exports are hashes-and-metadata only; the privacy canary extends to CSV and report bytes
Context: PRD C4 makes hashes-only a hard privacy default for the store. Exports are a second surface through which raw content could leak.
Decision: CSV and report emit exactly the §4 record fields — no export path reconstructs or emits raw content (none exists to reconstruct: the store never has it). The WP1 canary is extended: sentinel content seeded through the text and media append paths must not appear in the CSV or report output bytes, with the record's output_hash as positive control.
Consequences: The privacy posture is identical across store, JSONL, CSV, and report; the export canary is under the same never-delete/skip/weaken law as the store canary.
Discovery signal: n/a — prescribed by WP4.

ADR-0027 · 2026-07-07 · export filters (system_id, modality, since/until) as simple params; fixed §4 CSV column order
Context: PRD C3 exports need to scope to a feature or a period (e.g. "everything system X generated in July") without a query language.
Decision: One optional `ExportFilter` (`systemId`, `modality`, `since`, `until` — ANDed) applies to both `exportCsv` and `buildAuditReport`; unfiltered full-store export is the default. `since`/`until` accept any Date.parse-able instant, are normalized to ISO 8601 UTC, and bound `ts` inclusively (lexicographic comparison is sound because stored `ts` is always `toISOString()` output). CSV column order is fixed and matches the §4 schema exactly (`CSV_COLUMNS`); `marking_methods` is serialized as its JSON array, RFC 4180-escaped. The CLI (`gsengai-audit`) exposes the same filters; it additionally requires `--store` (not in the WP's sketched invocation, but the bin has no other way to locate the DB) and refuses a nonexistent store path rather than implicitly creating an empty one.
Consequences: Filters stay greppable SQL WHERE clauses; a v2 schema change forces a deliberate CSV_COLUMNS update; report headers name the normalized filter actually applied.
Discovery signal: n/a — prescribed by WP4.

ADR-0028 · 2026-07-07 · demo stack: Next.js app in apps/demo, subsuming the standalone example app
Context: WP5 needs a self-contained web demo exercising the real @gsengai/core and @gsengai/c2pa. better-sqlite3 and the C2PA signer are native binaries and cannot run in-browser, so a server tier is required regardless of framework.
Decision: Next.js (App Router) in `apps/demo` (`@gsengai/demo`, private, workspace member). Route handlers use Web-standard Request/Response (never NextRequest) so vitest tests call them directly, offline, with no server boot. The deferred standalone Next.js example app (ROADMAP §3) is subsumed by this demo — both will not be built. `marked` renders the audit-report sample (demo-only dependency; core keeps zero rendering deps per ADR-0024). Root `pnpm demo` builds the workspace deps and starts the app.
Consequences: `serverExternalPackages` alone does not externalize pnpm-workspace packages (the symlink resolves outside node_modules, they get bundled, and @gsengai/c2pa's import.meta.url-relative dev-cert paths break — discovered as a build failure); next.config.ts additionally pins @gsengai/*, better-sqlite3 and @contentauth/c2pa-node as webpack server externals. Tests live in apps/demo/test under the root vitest config.
Discovery signal: n/a — stack prescribed by WP5; the externals workaround was forced by the observed `next build` failure.

ADR-0029 · 2026-07-07 · demo privacy architecture: client-side hashing, hashes-only endpoint, per-request in-memory store
Context: The demo must stay inside the hash-only privacy law (PRD C4) while strangers paste text and upload images into it.
Decision: Text is hashed in the browser (Web Crypto + a client port of the §5 normalization; parity with core's hashText pinned by test) — raw text never transits. The text endpoint accepts exactly {outputHash, outputHashNormalized, hashVersion} and rejects any payload with unknown fields, so raw content cannot even arrive by accident. Image bytes must transit for the native signer but are processed buffer-in/buffer-out (8 MiB cap) and never persisted. The store is created per request as SQLite `:memory:`, seeded with two labeled sample records (so the visitor's record has a non-null prev_hash and chain verification spans three links), and closed — wiped — before the response leaves; an open-store counter is test-asserted back to zero. Per-request (rather than process-lifetime) scoping also keeps the prepared serverless deployment honest: function instances share no state.
Consequences: Nothing a visitor enters survives the request anywhere; the UI states this plainly. The §4 record and chain verification shown are real (real store, real hash chain), just short-lived.
Discovery signal: n/a — prescribed by WP5.

ADR-0030 · 2026-07-07 · dev-cert honesty: the untrusted-issuer caveat renders statically in the image flow, before the verify link
Context: Demo-signed images use the bundled development certificates; contentcredentials.org will flag the issuer as untrusted. Unexplained, that reads as "broken demo".
Decision: The image-flow card renders the caveat — development certificates; production uses a trusted CA certificate; the verifier will show the issuer as untrusted, which is expected — as static copy in the same view as the verify link, visible before any result exists and before the user can click through. The manifest summary displays the validator's exact failure codes (signingCredential.untrusted) as-is, labeled as the expected dev-cert outcome; nothing is filtered.
Consequences: The "untrusted" verdict is pre-empted on-screen, not excused after the fact; tests pin the caveat's static render and its colocation with the verify link.
Discovery signal: n/a — prescribed by WP5.

ADR-0031 · 2026-07-07 · positioning law over the demo; §9 pinned byte-identical to core's constant
Context: The demo is user-facing copy end to end (CLAUDE.md non-negotiable #6), and client components cannot import the server-side PRD_S9_LIMITS constant from @gsengai/core.
Decision: lib/copy.ts carries the demo's §9 block, and a test pins it byte-identical to core's PRD_S9_LIMITS (copy exists only for bundling reasons, never as a second source of truth); the rendered list is derived from that string, not retyped. The WP2–WP4 positioning lint is extended over every shipped demo source file (banned phrases absent), all demo copy says "supports compliance with …", and the brand appears only via the tokenized BRAND constant (name embargo).
Consequences: A §9 edit in core fails the demo test until the copy is re-synced; demo copy cannot drift into compliance promises without a red test.
Discovery signal: n/a — prescribed by WP5.

ADR-0032 · 2026-07-09 · name lock: gsengai, scopes @gsengai/*
Context: The packages shipped behind a single tokenized brand constant (ADR-0031) so the final name would be a one-line change. The maintainer locked the public name.
Decision: The product name is gsengai. All package scopes become @gsengai/*; the CLI bin becomes gsengai-audit; the C2PA generator name and assertion label become gsengai-c2pa and org.gsengai.generator; disclosure CSS classes become .gsengai-*; dev-cert CN honesty strings become "gsengai DEV … NOT TRUSTED …". Availability verified 2026-07-09 — GitHub org, npm scope, and .com/.ai/.io/.dev all unclaimed; the GitHub org and npm scope were reserved before any public push.
Consequences: 448 occurrences across ~80 files swapped; dev certs, disclosure icons, and snapshots regenerated; 166 tests green, build/lint/typecheck clean. On-the-wire manifest identifiers changed, which is acceptable because nothing has been published — there is no in-the-wild provenance to preserve.
Discovery signal: maintainer name decision (2026-07-09).

ADR-0033 · 2026-07-09 · embargo lift
Context: CLAUDE.md carried a hard name/publish embargo (codename only, no public remote, no npm) pending the rename WP.
Decision: With the name locked and the GitHub org and npm scope reserved, retire the embargo for this repo state — the product name may appear in the repo, a public remote is permitted, and npm publish is permitted. Every other non-negotiable stays in force (positioning law, hash-only privacy + canary, append-only + hash chain, ingredient preservation, fail-open) and is explicitly out of scope for this lift.
Consequences: The CLAUDE.md embargo section is replaced with the post-lock reality; the first actual npm publish remains a separate deliberate step, not bundled into the rename.
Discovery signal: n/a — prescribed by WP6.

ADR-0034 · 2026-07-09 · public repo is a clean-history extraction, not the working repo
Context: The private working repo carries full git history and internal planning docs whose commit messages reference the pre-release process.
Decision: Publish by extracting only the SHIPS-classified files into a fresh repository with a single clean initial commit under the gsengai org, rather than pushing the existing history. This supersedes the earlier options to git-rm-cached the committed internal files and to squash history — the old .git never travels, so internal files and codename history cannot leak.
Consequences: The private working repo stays the source of truth (history, ADRs, and internal planning docs); the public repo has no pre-launch history. Verification (four gates, secret sweep, positioning lint, codename grep) is re-run against the fresh extracted tree, not only the working repo.
Discovery signal: maintainer requirement — clean public history (2026-07-09).

ADR-0035 · 2026-07-12 · dual signing backend: native c2pa-node with automatic c2patool fallback
Context: ADR-0014 pinned `@contentauth/c2pa-node@0.6.0` as the sole backend on the strength of a macOS smoke gate, and recorded its prebuilt binaries as installing via postinstall. In reality the npm tarball ships only a macOS-arm64 binary: the postinstall downloader builds a release URL from a `v0.6.0` tag that does not exist (the real tag is `@contentauth/c2pa-node@0.6.0`), and even the correctly named release carries no binary assets — prebuilts are unobtainable on every platform, so signing worked only on Apple Silicon (issue #1). The module also loads its `.node` binary lazily, so a successful import proves nothing about whether the binary works.
Decision: A backend abstraction resolves once per process at first use: dynamically import the native module and probe it with a real read of an embedded manifest-less PNG; on any failure fall back to a `c2patool` subprocess (the standalone CLI over the same c2pa-rs core), discovered via `GSENGAI_C2PATOOL_PATH`, `PATH`, or the `c2patoolPath` option, and forceable either way with `GSENGAI_C2PA_BACKEND=native|c2patool`. c2patool runs under `execFile` (no shell); assets pass through a private temp dir that is always removed; signing credentials are passed as file paths so key material is never copied; an explicit `--settings` file preserves the offline discipline (no OCSP, no remote-manifest fetch, no TSA) and disables the auto claim thumbnail so both backends produce equivalent manifests.
Consequences: Image signing runs on Linux, Windows, and Intel macs after a one-time c2patool install. CI runs an ubuntu+macos matrix (c2patool pinned by version and sha256) so both backends stay covered. Tests read assets through the resolved backend — any direct import of `@contentauth/c2pa-node` outside the resolver reintroduces the Linux break. Supersedes ADR-0014's single-backend statement; the exact 0.6.0 pin stays.
Discovery signal: issue #1 — `invalid ELF header` on Linux; root cause verified against the upstream release assets (2026-07-12).

ADR-0036 · 2026-07-12 · public repo becomes the sole working repo and source of truth
Context: ADR-0034 kept the private working repo as the source of truth for history, ADRs, and internal planning after the clean-history extraction. Since launch, all development, releases (v0.2.0), and decision records have happened in the public repo; maintaining two logs invites drift.
Decision: The public repo is the sole working repo and the source of truth, including for this decision log. The old private repo is retired as an archive and is no longer read or updated.
Consequences: New ADRs land only here; the mirroring step is gone. Anything still needed from the private repo (e.g. unreleased planning notes) must be migrated deliberately before relying on the archive going stale.
Discovery signal: maintainer decision (2026-07-12).
