# Releasing

Publishing to npm is currently **manual** — done from a maintainer's machine with interactive 2FA. Automating it from CI (OIDC trusted publishing) is blocked by upstream tooling and tracked in [#2](https://github.com/gsengai/gsengai/issues/2). The demo app (`apps/demo`) is private and is never published.

## Publishing a release

1. Bump the versions you are releasing (keep them in step for 0.x):
   ```sh
   pnpm -r exec npm version <patch|minor> --no-git-tag-version
   ```
   - **Always bump `@gsengai/core` and `@gsengai/c2pa` together.** c2pa depends on core as `workspace:^`, which is rewritten to `^<core's version>` at pack time. A c2pa release packed against an unbumped core lets installs resolve an older core that silently drops what c2pa records (for example `signer_cert_sha256`).
   - Set `VERSION` in `packages/c2pa/src/constants.ts` to the new c2pa version. It is recorded inside every signed manifest.
2. Move the relevant notes in `CHANGELOG.md` under a new `## [x.y.z]` heading.
3. Verify and publish from your machine, **core first**:
   ```sh
   pnpm install --frozen-lockfile
   pnpm test && pnpm build
   # c2pa's packed dependency range must name the new core version:
   pnpm --filter @gsengai/c2pa pack --pack-destination /tmp \
     && tar -xOzf /tmp/gsengai-c2pa-*.tgz package/package.json | grep '"@gsengai/core"'
   npm login                                   # if not already; completes 2FA
   pnpm --filter @gsengai/core publish --access public --no-git-checks
   pnpm -r publish --access public --no-git-checks   # the rest; already-published versions are skipped
   ```
   Publish `@gsengai/core` before `@gsengai/c2pa`: c2pa's range on core comes from core's version at pack time, so until that core version is on npm, installs of the new c2pa cannot resolve it. Complete the browser 2FA prompt when asked. If a package times out mid-run (the OTP window is short), re-run just that one: `pnpm --filter @gsengai/<name> publish --access public --no-git-checks` — and never publish c2pa while the core version it names is not yet live.
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
