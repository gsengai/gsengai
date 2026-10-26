# Signing certificates: development vs production

`@gsengai/c2pa` signs C2PA manifests with an X.509 certificate. Which certificate
you sign with determines whether anyone else trusts the result. This page is
honest about that.

## The bundled development certificates

The package ships a self-signed ES256 (P-256) certificate chain under
`packages/c2pa/dev-certs/` so the quickstart and the tests work without a
certificate of your own. `createImageSigner` uses it only when you opt in
explicitly, and prints a one-time warning when you do:

```ts
const signer = createImageSigner({ store, systemId: "my-image-feature", devCertificates: true });
```

There is no silent fallback. `createImageSigner` throws, with a pointer to
this page, unless you pass either both `certPath` and `keyPath` or neither of
them plus `devCertificates: true`. Passing only one of the two paths, or
combining `devCertificates: true` with a path, throws too.

**Manifests signed with the dev certificates fail public trust validation by
design.** Validators — including [contentcredentials.org/verify](https://contentcredentials.org/verify)
and `c2patool` — will report the signature as cryptographically valid but the
credential as untrusted (`signingCredential.untrusted`), because the issuing
CA is not on any C2PA trust list. Locally, `readManifest` reports exactly the
same status codes; nothing in this library pretends otherwise.

Use the dev certificates for integration testing only. The signing key is
committed to the repository and ships in the published `@gsengai/c2pa`
package: it is public, it protects nothing, and it must protect nothing.
Regenerate the pair anytime with `scripts/gen-dev-certs.sh` — but note that
this changes the dev certificate's fingerprint. Detection (below) compares
against the chain the installed package ships, so keep the previous chain's
fingerprint to find outputs signed before the change.

**Never add the dev root certificate to a C2PA trust list**, a validator's
trust anchors, or your own trust configuration, and never trust the dev leaf
directly either. The signing key that the dev root certifies is public, so
trusting the root would make anything anyone signs with that key validate as
trusted.

### Finding dev-signed outputs

Every image signing records the SHA-256 fingerprint of the leaf signing
certificate in the evidence record as `signer_cert_sha256` (null for text
records). To find everything signed with the dev certificate, compute the dev
leaf's fingerprint from the chain your installed package ships (the first
certificate in the file) and compare:

```ts
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

// In a clone of this repository: packages/c2pa/dev-certs/dev-cert-chain.pem
const devLeaf = new X509Certificate(
  readFileSync("node_modules/@gsengai/c2pa/dev-certs/dev-cert-chain.pem"),
);
const devSha256 = devLeaf.fingerprint256.replaceAll(":", "").toLowerCase();

await store.exportJsonl("./evidence.jsonl");
const devSigned = readFileSync("./evidence.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .filter((record) => record.signer_cert_sha256 === devSha256);
```

(`openssl x509 -in dev-cert-chain.pem -noout -fingerprint -sha256` prints the
same fingerprint in upper case with colons.) The CSV export (`exportCsv`, or
`gsengai-audit export --format csv`) carries the same value in its last
column. Records appended before 0.3.0, when `signer_cert_sha256` was added,
carry null and cannot be classified from the store alone.

For a single asset, `readManifest` reports `signedWithDevCertificate`, matched
by leaf-certificate fingerprint against the chain shipped with the installed
package. It has three values:

- `true`: the active manifest was signed with the bundled dev certificate.
- `false`: the signing certificate was determined, and it is not the dev
  certificate.
- `null`: the signing certificate could not be determined. **Treat `null` as
  unknown, never as "not dev-signed".** It is null when the asset does not
  carry exactly one embedded manifest store, when the signature cannot be read
  unambiguously, or when the certificate read from the asset is not the signer
  the validator reported (same serial number and subject organization) — the
  flag only ever describes the signature the validator actually checked.

It looks at the active manifest only, not at parent ingredients, and says
nothing about signature validity (see `validationStatusCodes` for that).

## The production path

For manifests that public validators accept, you need:

1. **A CA-issued signing certificate that meets the C2PA certificate
   requirements** — issued for claim signing (digital-signature key usage and
   an appropriate EKU), from a certification authority whose root is accepted
   by the validators you care about. The [C2PA conformance program](https://c2pa.org/conformance/)
   lists conforming products and the trust-list process; several commercial
   CAs sell C2PA-compatible signing certificates.
2. **Key storage that matches the value of the credential** — keep the private
   key in a KMS or HSM, not on disk. `createImageSigner` accepts file paths
   (`certPath`/`keyPath`) for locally held keys; KMS/HSM-backed signing via a
   callback signer is planned post-MVP.
3. **A timestamp authority (optional, post-MVP here)** — a TSA countersignature
   keeps manifests verifiable after the signing certificate expires. This MVP
   deliberately configures no TSA URL (tests and default operation are fully
   offline).

When you have a production certificate:

```ts
const signer = createImageSigner({
  store,
  systemId: "my-image-feature",
  certPath: "/path/to/your-chain.pem", // leaf first, then intermediates
  keyPath: "/path/to/your-key.pem",    // PKCS#8 PEM
});
```

No dev-cert warning is printed when both paths are provided. Leave
`devCertificates` out of production configuration entirely.

## Scope of the signature

A C2PA manifest binds provenance metadata to the exact signed bytes. Anything
that re-encodes the image — screenshots, most platform uploads, format
conversion — strips or invalidates the manifest. That is a property of the
format, not of your certificate, and it is exactly why the evidence store logs
every signing independently (PRD: multi-layer marking).

---

> **What this does NOT do**
>
> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.
> - It does not embed imperceptible watermarks (MVP). It implements the signed-metadata and logging/fingerprinting layers of a multi-layer marking strategy.
> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.
> - It does not detect third-party AI content.
> - It is not legal advice. Consult qualified counsel about your obligations.
