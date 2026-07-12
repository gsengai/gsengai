# Releasing

Publishing to npm is currently **manual** — done from a maintainer's machine with interactive 2FA. Automating it from CI (OIDC trusted publishing) is blocked by upstream tooling and tracked in [#2](https://github.com/gsengai/gsengai/issues/2). The demo app (`apps/demo`) is private and is never published.

## Publishing a release

1. Bump the versions you are releasing (keep them in step for 0.x):
   ```sh
   pnpm -r exec npm version <patch|minor> --no-git-tag-version
   ```
2. Move the relevant notes in `CHANGELOG.md` under a new `## [x.y.z]` heading.
3. Verify and publish from your machine:
   ```sh
   pnpm install --frozen-lockfile
   pnpm test && pnpm build
   npm login                                   # if not already; completes 2FA
   pnpm -r publish --access public --no-git-checks
   ```
   Complete the browser 2FA prompt when asked. If a package times out mid-run (the OTP window is short), re-run just that one: `pnpm --filter @gsengai/<name> publish --access public --no-git-checks`.
4. Commit, tag, and push:
   ```sh
   git commit -am "Release vX.Y.Z"
   git tag vX.Y.Z
   git push --follow-tags
   ```
5. Create a GitHub Release for the tag. The **Release verification** workflow installs, tests, and builds the tagged commit (it does not publish).

## Notes

- `pnpm publish` rewrites `workspace:*` dependency ranges to real versions automatically.
- A version that already exists on npm is rejected; always bump first. A version whose publish was interrupted is **tombstoned for 24h** — bump past it rather than retrying the same number.
- Keep `apps/demo` `private: true` so it is never accidentally published.
- Provenance is not attached by the manual flow; it returns once CI publishing is restored (#2).

## Restoring automated publishing (#2)

Trusted publishers are already configured for all six packages. When pnpm supports OIDC for recursive publish (or the CI npm `sigstore` packaging is fixed), restore the OIDC publish job from git history, re-enable `id-token: write`, and tighten each package to "require 2FA and disallow tokens." (The repo carries no npm secret — the old `NPM_TOKEN` was deleted once the workflows stopped referencing it.)
