# Security policy

## Reporting a vulnerability

Please report security issues privately, not as a public issue.

Use GitHub's private vulnerability reporting: go to the **Security** tab and choose **Report a vulnerability** (or open [a new advisory](https://github.com/gsengai/gsengai/security/advisories/new)).

Include what you found, how to reproduce it, and the affected package and version. We aim to acknowledge a report within a few business days. Please give us a reasonable window to release a fix before any public disclosure.

## Scope

This project is pre-1.0. Security fixes land on the latest published version.

Relevant to how this tool works:

- **The bundled development certificates are intentionally untrusted.** Anything signed with them fails public trust validation by design, and the docs say so. That is expected behavior for integration testing, not a vulnerability. Production signing requires your own certificates. See [docs/CERTIFICATES.md](./docs/CERTIFICATES.md).
- **The evidence store keeps hashes and metadata only.** Raw prompts and outputs are never persisted. If you find a path that writes raw content to disk, that is a bug we want to hear about.
- **C2PA manifests can be removed downstream** by re-encoding, screenshots, or a platform re-upload. This is a known limitation of content marking, documented for users, not a defect in the signing itself.

## What is not in scope

Legal or compliance adequacy. This project provides a technical layer and is not legal advice; whether a given deployment meets a regulatory obligation depends on your system and process.
