# Development certificates — NOT TRUSTED, integration testing only

> **⚠️ These are self-signed development certificates.** Anything signed with
> them **fails public trust validation by design** (validators report
> `signingCredential.untrusted`). They exist so the quickstart and the test
> suite work without a certificate of your own, behind the explicit opt-in
> `devCertificates: true`. **Never use them in production.** For the
> production certificate path (CA-issued certificate meeting the C2PA trust
> requirements, keys in a KMS/HSM), see [`docs/CERTIFICATES.md`](../../../docs/CERTIFICATES.md).

Files:

- `dev-cert-chain.pem` — ES256 (P-256) leaf signing certificate + self-signed dev root, leaf first. The leaf carries the C2PA claim-signing profile (critical `digitalSignature` key usage, `emailProtection` EKU, `CA:FALSE`).
- `dev-private-key.pem` — the leaf's PKCS#8 private key. It is deliberately public: it protects nothing and must protect nothing.

Regenerate with `scripts/gen-dev-certs.sh` from the repo root (requires `openssl`).

`createImageSigner` uses these files only on the explicit opt-in
`devCertificates: true`, and prints a one-time warning to stderr when you opt
in. There is no fallback: without the opt-in, it throws unless you pass both
`certPath` and `keyPath` for a certificate of your own.

This library supports compliance with EU AI Act Article 50 and California
SB 942; it does not make you compliant and is not legal advice.
