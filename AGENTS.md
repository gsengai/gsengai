# AGENTS.md

Guidance for AI-assisted work in this repository — and a briefing for human contributors. The rules below are project law; most are enforced by tests, all are enforced by review. (`CLAUDE.md` imports this file, so Claude Code and AGENTS.md-reading agents share one source of truth.)

## Non-negotiables

1. **Positioning**: all user-facing copy says "supports compliance with EU AI Act Article 50 and California SB 942" — never "makes you compliant," "ensures/guarantees compliance," or anything promising a legal outcome. Not legal advice. Enforced by the positioning-lint tests.
2. **Privacy**: hashes and metadata only — raw prompts and outputs never persist, in the store or in any export. Enforced by canary tests (in `packages/core/test/store.test.ts`, `packages/core/test/export.test.ts`, and the media canary in `packages/c2pa/test/c2pa.test.ts`). Never delete, skip, or weaken a canary test.
3. **Append-only**: the evidence store has no update or delete path (API or SQL). The hash chain stays intact; `verifyChain()` breaks are reported, never suppressed.
4. **Ingredient preservation**: never overwrite an existing C2PA manifest — chain it as a parent ingredient (PRD B3, ADR-0015).
5. **Wrappers never mutate or block model responses**: hash in memory, append a record, return the response unmodified. Fail-open is the default (warn + lost-record counter); `failMode: 'strict'` is opt-in.
6. **Green gates before every commit**: `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck` — all four, no exceptions.

## Sharp edges

- **Never import `@contentauth/c2pa-node` directly** — anywhere, including tests. It loads its native binary lazily and only works on macOS arm64; all access goes through the backend resolver in `packages/c2pa/src/backend.ts` (native or c2patool fallback — ADR-0035). A direct import passes locally on a Mac and breaks Linux CI.
- Keep the `VERSION` constant in `packages/c2pa/src/constants.ts` in step with the package version on release — it is recorded inside every signed manifest.
- Publishing is manual — see `RELEASING.md` (including the 24-hour tombstone rule for interrupted publishes). Do not attempt to automate publishing; the blockers are tracked in issue #2.
- The bundled dev certificates are intentionally untrusted; keep every place that touches them honest about it.

## Orientation

- Architecture decisions: `DECISIONS.md` (append-only ADR log — supersede, don't rewrite).
- What is and is not captured: `docs/capture-coverage.md`.
- Production concerns (platform support, cert handling, store topology, failure modes): `docs/production.md`.
- CI runs an ubuntu + macOS matrix so both C2PA signing backends stay covered — keep it that way.
