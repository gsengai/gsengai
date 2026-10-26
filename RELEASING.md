# Releasing

Publishing to npm is currently **manual** — done from a maintainer's machine with interactive 2FA. Automating it from CI (OIDC trusted publishing) is blocked by upstream tooling and tracked in [#2](https://github.com/gsengai/gsengai/issues/2). The demo app (`apps/demo`) is private and is never published.

## Publishing a release

1. **Prepare the release on a branch** and land it through a PR, so what you publish is exactly what CI checked on `main`:
   ```sh
   git checkout -b release/vX.Y.Z
   pnpm -r exec npm version <patch|minor> --no-git-tag-version   # keep versions in step for 0.x
   ```
   - **Always bump `@gsengai/core` and `@gsengai/c2pa` together.** c2pa depends on core as `workspace:^`, which is rewritten to `^<core's version>` at pack time. A c2pa release packed against an unbumped core lets installs resolve an older core that silently drops what c2pa records (for example `signer_cert_sha256`).
   - Set `VERSION` in `packages/c2pa/src/constants.ts` to the new c2pa version. It is recorded inside every signed manifest.
   - Move the relevant notes in `CHANGELOG.md` under a new `## [x.y.z] — YYYY-MM-DD` heading.
   - **Sweep for version-dependent text** before you commit — package READMEs ship inside the npm tarballs, so they must be right before publishing. Search every tracked file (PCRE: `git grep -E` silently ignores `\b`) and decide for each hit whether it is history or needs the new version:
     ```sh
     git grep -P -n -I "(?<![\w.-])v?0\.\d+(\.\d+)?(?![\w.])" -- . ':!pnpm-lock.yaml' ':!CHANGELOG.md' ':!DECISIONS.md'
     ```
     Also check: `ROADMAP.md` ("Available today (vX.Y)" and its list), the README package table and its supported SDK versions, each package README's "Requires …" line, the README "Built with" credits, and any time-relative claims ("today", "not yet", "planned", dates).

   Commit as `Release vX.Y.Z`, push the branch, open a PR, and merge it (as a merge commit, not squashed) once CI is green.
2. **Verify and publish from the merged `main`, core first:**
   ```sh
   git checkout main && git pull
   pnpm install --frozen-lockfile
   pnpm test && pnpm build
   # c2pa's packed dependency range must name the new core version:
   pnpm --filter @gsengai/c2pa pack --pack-destination /tmp \
     && tar -xOzf /tmp/gsengai-c2pa-*.tgz package/package.json | grep '"@gsengai/core"'
   npm login                                   # if not already; completes 2FA
   pnpm --filter @gsengai/core publish --access public --no-git-checks
   pnpm -r --filter '!@gsengai/core' publish --access public --no-git-checks   # all the others
   ```
   - Publish `@gsengai/core` before `@gsengai/c2pa`: c2pa's range on core comes from core's version at pack time, so until that core version is on npm, installs of the new c2pa cannot resolve it.
   - **Exclude core explicitly in the second command.** npm takes a minute or two to process a new version, and during that window `pnpm -r publish` does not see it as published, tries again, and fails with `409 … Cannot publish over previously staged version` (seen on 0.3.0). That 409 overwrites nothing and is not an interrupted publish — no bump needed.
   - Complete the browser 2FA prompt for each package. If a run stops partway, check what is live first (`npm view @gsengai/<name>@X.Y.Z version` — a package can take a minute to show up after its `+ @gsengai/<name>@X.Y.Z` line), then publish only the missing ones: `pnpm --filter @gsengai/<name> publish --access public --no-git-checks`. Never publish c2pa while the core version it names is not yet live.
   - **Verify on npm** before moving on — every package is `latest` at the new version, and the published manifests name the new core version and the intended peer ranges:
     ```sh
     for p in core openai anthropic ai-sdk c2pa disclosure; do npm view "@gsengai/$p" dist-tags.latest; npm view "@gsengai/$p@X.Y.Z" dependencies peerDependencies; done
     ```
3. **Create the GitHub Release** for the merge commit — still checked out from step 2. This also creates the tag on GitHub (a plain `git push` does not push tags). Write the notes (the CHANGELOG section plus upgrade notes) to `release-notes.md` first:
   ```sh
   gh release create vX.Y.Z --target "$(git rev-parse HEAD)" --title vX.Y.Z --notes-file release-notes.md
   ```
   The **Release verification** workflow then installs, tests, and builds the tagged commit (it does not publish).
4. **Deprecate superseded versions** when the release fixes a security issue in them, with the reason and the upgrade path — as for `@gsengai/c2pa` before 0.3.0:
   ```sh
   npm deprecate @gsengai/<name>@"<X.Y.Z" "<what is wrong>. Upgrade to >=X.Y.Z, <what changed>."
   ```

## Notes

- `pnpm publish` rewrites `workspace:*` dependency ranges to real versions automatically.
- A version that already exists on npm is rejected; always bump first. A version whose publish was interrupted is **tombstoned for 24h** — bump past it rather than retrying the same number.
- Keep `apps/demo` `private: true` so it is never accidentally published.
- Provenance is not attached by the manual flow; it returns once CI publishing is restored (#2).

## Restoring automated publishing (#2)

Trusted publishers are already configured for all six packages. When pnpm supports OIDC for recursive publish (or the CI npm `sigstore` packaging is fixed), restore the OIDC publish job from git history, re-enable `id-token: write`, and tighten each package to "require 2FA and disallow tokens." (The repo carries no npm secret — the old `NPM_TOKEN` was deleted once the workflows stopped referencing it.)
