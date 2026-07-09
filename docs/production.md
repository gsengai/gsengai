# Deploying to production

This project supports compliance with EU AI Act Article 50 and California SB 942 by providing the technical marking and logging layer. It does not make you compliant and is not legal advice. Getting from a working demo to a live deployment for real users involves the decisions below. Hand this to whoever integrates it.

## 1. Get the packages

Until the packages are published to npm, install by vendoring this monorepo: clone it, run `pnpm install`, and depend on the workspace packages. Once published, install the scoped `@gsengai/*` packages directly. The README's `import` examples assume the published packages.

## 2. Signing certificates

The bundled development certificates are untrusted by design: anything signed with them fails public trust validation and is for integration testing only. For production, pass your own certificate chain and key to `createImageSigner` via `certPath` / `keyPath`, using a certificate from a conforming C2PA certificate authority. See [CERTIFICATES.md](./CERTIFICATES.md).

Keys are read from files today. Signing from a KMS or HSM is on the roadmap; until then, protect the key file with your platform's secret handling.

**Platform note:** with `@contentauth/c2pa-node@0.6.0`, the native signing binary currently loads only on macOS (Apple Silicon) — its prebuilt binaries are unavailable for Linux, Windows, and Intel macs in this release. Cross-platform signing through a `c2patool` fallback is planned (see the roadmap). The text, evidence-store, audit, and disclosure features are pure JavaScript and run anywhere Node 22 runs.

## 3. Evidence-store topology

The default store is a single-writer SQLite file, which fits a single instance well. If you run the feature across several instances or containers writing to one store, route writes through a single dedicated writer, or keep a store per instance and merge for audit. A shared-store mode is on the roadmap.

Two native modules (`better-sqlite3` and the C2PA signer) compile per platform; budget for this on Alpine, ARM, and serverless targets.

## 4. Decide the failure behavior

By default the wrappers fail open: if the evidence store is unavailable, your feature keeps serving users and logging is skipped, with a loud warning and an incremented `getLostRecordCount()`. Monitor that counter, or you will have gaps in the log without knowing. The alternative, `failMode: 'strict'`, throws instead, which protects the log but lets an evidence outage affect the user-facing feature. This is a product tradeoff; decide it deliberately.

## 5. Confirm capture coverage

[capture-coverage.md](./capture-coverage.md) lists exactly what is and is not logged, including streaming patterns such as `Stream.tee()` and tool-only responses. Confirm your application does not rely on a path that bypasses logging.

## 6. Understand the integrity model

The evidence store is tamper-evident: `verifyChain()` detects casual and accidental edits or deletions, and there is no update or delete path in the API or in SQL. It is not forgery-proof against someone who has both write access to the database file and the (open-source) code, because the chain uses no secret key and is not anchored to any external service. Treat it as a detection mechanism, and pair it with access controls, backups, and — when available — external anchoring or trusted timestamping.

## 7. Get legal sign-off

Whether a given deployment meets Article 50 or SB 942 is a legal determination that depends on your system and processes. This project provides a technical layer and says so throughout. Have qualified counsel confirm your obligations and how you meet them.
