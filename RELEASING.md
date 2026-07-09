# Releasing

The `@gsengai/*` packages are published to npm from CI, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) attached. The demo app (`apps/demo`) is private and is never published.

## One-time setup

1. The npm organization `gsengai` exists and owns the `@gsengai` scope.
2. Create an npm **automation** access token with publish rights to the scope, and add it to the GitHub repository as a secret named `NPM_TOKEN` (Settings → Secrets and variables → Actions).

Provenance requires the CI path (a public repo publishing through GitHub Actions with OIDC), so releases go through the workflow, not a laptop.

## Cutting a release

1. Bump the version on the packages you are releasing. For 0.x, keep them in step:
   ```sh
   pnpm -r exec npm version <patch|minor> --no-git-tag-version
   ```
2. Move the relevant `## [Unreleased]` notes in `CHANGELOG.md` under a new `## [x.y.z]` heading.
3. Commit and tag:
   ```sh
   git commit -am "Release vX.Y.Z"
   git tag vX.Y.Z
   git push --follow-tags
   ```
4. Create a GitHub Release for the tag. Publishing the release triggers `.github/workflows/release.yml`, which installs, tests, builds, and runs `pnpm -r publish --access public --provenance`.

## Manual fallback

If you must publish from a laptop (no provenance this way):

```sh
pnpm install --frozen-lockfile
pnpm test && pnpm build
npm login                       # once
pnpm -r publish --access public
```

## Notes

- `pnpm publish` rewrites `workspace:*` dependency ranges to real versions automatically.
- A version that already exists on npm will be rejected; always bump first.
- Keep `apps/demo` `private: true` so it is never accidentally published.
