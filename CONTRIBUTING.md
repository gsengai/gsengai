# Contributing

Thanks for your interest. This project supports compliance with EU AI Act Article 50 and California SB 942 by providing the technical marking and logging layer: text output logging and fingerprinting, C2PA signing for media, an append-only evidence store with audit export, and a disclosure UI kit. It does not make anyone compliant and is not legal advice.

## Getting set up

Requirements: Node >= 22 and pnpm.

```sh
pnpm install
pnpm test        # vitest, no network
pnpm build       # tsup (ESM + CJS)
pnpm lint        # biome
pnpm typecheck   # tsc
```

All four gates should be green before you open a PR. Tests never hit the network; mock SDK clients, and use the `ai/test` mock models for the Vercel AI SDK.

## Ground rules

A few constraints are structural to what this project is. PRs that break them will be asked to change:

- **Hashes and metadata only.** Raw prompts and outputs are never written to disk. There is a canary test asserting no raw bytes reach the database file; do not weaken, skip, or delete it.
- **Append-only evidence.** There is no update or delete path on the evidence store, in the API or in SQL. The hash chain stays intact.
- **Preserve existing provenance.** When signing media that already carries a C2PA manifest, chain it as an ingredient. Never overwrite it.
- **Wrappers never mutate or block a model response.** The default is fail-open with a loud warning and a lost-record counter; strict mode is opt-in.
- **Positioning.** User-facing strings, docs, and examples say "supports compliance with …". They never claim to make you compliant, ensure, guarantee, or certify anything, and they do not give legal advice.

## Pull requests

- Keep each PR focused on one concern.
- New behavior lands with its tests.
- Record any non-obvious design choice as an ADR in `DECISIONS.md`, continuing the sequential numbering.
- Update the docs (`README.md`, `QUICKSTART.md`, `docs/`) when behavior or a capability gap changes. Known capture and coverage gaps are documented for users, not hidden.

## Reporting bugs and security issues

Open an issue for bugs. For anything security-sensitive, follow [SECURITY.md](./SECURITY.md) and report privately rather than in a public issue.
