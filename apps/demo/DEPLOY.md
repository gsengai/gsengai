# Deploying the demo (prepared, NOT executed)

> **Do not deploy before the project is publicly named.** A public deployment is
> a public mention, so it is gated on the product name lock. This config is
> committed so launch is a one-command step once the name is final.

The demo supports compliance workflows only in the sense the rest of the repo
does — see the §9 limits block in [README.md](../../README.md). It ships no
secrets and needs no environment variables: the demo is keyless by design
(test-enforced).

## One-command deploy (after the name lock)

From the repo root, with the [Vercel CLI](https://vercel.com/docs/cli) logged in:

```sh
pnpm dlx vercel deploy --cwd apps/demo --prod
```

On first run, in the Vercel project settings:

- **Root Directory:** `apps/demo` (with "Include source files outside of the
  Root Directory" enabled — the workspace packages live in `packages/*`).
- Install/build commands come from `vercel.json` (workspace deps are built
  first; the demo build follows).

## Rename checklist (one-constant brand swap)

1. Change `BRAND` in [`lib/brand.ts`](./lib/brand.ts) — the single source of
   the product name in the demo.
2. Rename the `@gsengai/*` package scope (dedicated rename WP; not a demo concern).

## Runtime notes

- **Native modules:** `better-sqlite3` and `@contentauth/c2pa-node` are native
  binaries, kept external to the bundle (`next.config.ts`). They must be
  installed/built for the deployment target (Vercel's build step does this);
  validate both API routes on the preview deployment before promoting.
- **Statelessness:** the evidence store is created per request, in memory, and
  wiped — there is nothing to migrate or persist, so serverless function
  instances need no shared state.
- **Upload limit:** the image route caps uploads at 8 MiB; keep the platform
  body-size limit at or above that.
