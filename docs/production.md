# Deploying to production

This project supports compliance with EU AI Act Article 50 and California SB 942 by providing the technical marking and logging layer. It does not make you compliant and is not legal advice. Getting from a working demo to a live deployment for real users involves the decisions below. Hand this to whoever integrates it.

## 1. Get the packages

Install the scoped `@gsengai/*` packages from npm. Vendoring the monorepo (clone, `pnpm install`, depend on the workspace packages) also works if you prefer to pin to source.

## 2. Signing certificates

The bundled development certificates are untrusted by design: anything signed with them fails public trust validation and is for integration testing only. For production, pass your own certificate chain and key to `createImageSigner` via `certPath` / `keyPath`, using a certificate from a conforming C2PA certificate authority. See [CERTIFICATES.md](./CERTIFICATES.md).

Keys are read from files today. Signing from a KMS or HSM is on the roadmap; until then, protect the key file with your platform's secret handling.

**Platform note:** image signing resolves one of two equivalent backends at first use. On macOS (Apple Silicon) the native `@contentauth/c2pa-node` binary is used directly. Everywhere else — Linux, Windows, Intel macs — signing shells out to [c2patool](https://github.com/contentauth/c2pa-rs/tree/main/cli), contentauth's standalone CLI built on the same c2pa-rs library, which you install once: download a prebuilt binary from the [c2pa-rs releases](https://github.com/contentauth/c2pa-rs/releases) (look for the `c2patool-v*` assets) or run `cargo install c2patool`, and put it on `PATH`. The fallback is automatic; to control it explicitly, set `GSENGAI_C2PATOOL_PATH` (or the `c2patoolPath` option of `createImageSigner`) to the binary, or force a backend with `GSENGAI_C2PA_BACKEND=native|c2patool`. Both backends produce the same manifests, keep the same offline discipline (no OCSP, no remote fetches, no TSA), and never copy your private key — c2patool receives it as the file path you configured. The text, evidence-store, audit, and disclosure features are pure JavaScript and run anywhere Node 22 runs.

## 3. Evidence-store topology

The default store is a single-writer SQLite file, which fits a single instance well. If you run the feature across several instances or containers writing to one store, route writes through a single dedicated writer, or keep a store per instance and merge for audit. A shared-store mode is on the roadmap.

One native module (`better-sqlite3`) compiles per platform; budget for this on Alpine, ARM, and serverless targets. The C2PA signer needs no compilation — it uses the prebuilt native binary where available and the `c2patool` subprocess elsewhere (see the platform note above).

## 4. Decide the failure behavior

By default the wrappers fail open: if the evidence store is unavailable, your feature keeps serving users and logging is skipped, with a loud warning and an incremented `getLostRecordCount()`. Monitor that counter, or you will have gaps in the log without knowing. The alternative, `failMode: 'strict'`, throws instead, which protects the log but lets an evidence outage affect the user-facing feature. This is a product tradeoff; decide it deliberately.

## 5. Confirm capture coverage

[capture-coverage.md](./capture-coverage.md) lists exactly what is and is not logged, including streaming patterns such as `Stream.tee()` and tool-only responses. Confirm your application does not rely on a path that bypasses logging.

## 6. Understand the integrity model

The evidence store is tamper-evident: `verifyChain()` detects casual and accidental edits or deletions, and there is no update or delete path in the API or in SQL. It is not forgery-proof against someone who has both write access to the database file and the (open-source) code, because the chain uses no secret key and is not anchored to any external service. Treat it as a detection mechanism, and pair it with access controls, backups, and — when available — external anchoring or trusted timestamping.

## 7. Get legal sign-off

Whether a given deployment meets Article 50 or SB 942 is a legal determination that depends on your system and processes. This project provides a technical layer and says so throughout. Have qualified counsel confirm your obligations and how you meet them.
