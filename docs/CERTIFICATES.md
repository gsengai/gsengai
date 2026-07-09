# Signing certificates: development vs production

`@gsengai/c2pa` signs C2PA manifests with an X.509 certificate. Which certificate
you sign with determines whether anyone else trusts the result. This page is
honest about that.

## The bundled development certificates

The package ships a self-signed ES256 (P-256) certificate chain under
`packages/c2pa/dev-certs/` so the quickstart and the tests work with zero
setup. `createImageSigner` falls back to it when you pass no
`certPath`/`keyPath`, and prints a one-time warning saying so.

**Manifests signed with the dev certificates fail public trust validation by
design.** Validators — including [contentcredentials.org/verify](https://contentcredentials.org/verify)
and `c2patool` — will report the signature as cryptographically valid but the
credential as untrusted (`signingCredential.untrusted`), because the issuing
CA is not on any C2PA trust list. Locally, `readManifest` reports exactly the
same status codes; nothing in this library pretends otherwise.

Use the dev certificates for integration testing only. The private key is
committed to the repository — it protects nothing and must protect nothing.
Regenerate the pair anytime with `scripts/gen-dev-certs.sh`.

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

No dev-cert warning is printed when both paths are provided.

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
