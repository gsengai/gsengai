<!-- Thanks for contributing. Keep PRs focused; one concern per PR is easier to review. -->

## What this changes

<!-- A sentence or two. Link any related issue. -->

## Checklist

- [ ] `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck` all pass locally
- [ ] New behavior ships with tests
- [ ] No raw prompt/output text is persisted (hashes and metadata only)
- [ ] No update/delete path added to the evidence store (append-only)
- [ ] Existing C2PA manifests are chained as ingredients, never overwritten
- [ ] User-facing copy says "supports compliance with …" and makes no compliance guarantee
- [ ] A non-obvious design choice is recorded in `DECISIONS.md` (ADR)
