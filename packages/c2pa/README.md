# @gsengai/c2pa

C2PA Content Credentials signing for AI-generated images (PNG/JPEG): signed manifests declaring AI generation, pre-existing manifests preserved as chained ingredients (never overwritten), one evidence record per signing. Supports compliance with **EU AI Act Article 50** and **California SB 942**.

Part of [gsengai](https://github.com/gsengai/gsengai), open-source transparency and provenance tooling for AI product teams.

## Install

```sh
pnpm add @gsengai/c2pa @gsengai/core
```

Requires Node ≥ 22.

**Platform support:** works out of the box on macOS (Apple Silicon). On Linux, Windows, and Intel macs, install [c2patool](https://github.com/contentauth/c2pa-rs/tree/main/cli) once ([prebuilt binaries](https://github.com/contentauth/c2pa-rs/releases) or `cargo install c2patool`) and have it on `PATH` — the fallback backend is auto-detected and produces equivalent manifests. `GSENGAI_C2PATOOL_PATH` or the `c2patoolPath` option point at a specific binary; `GSENGAI_C2PA_BACKEND=native|c2patool` forces a backend. Details in [docs/production.md](https://github.com/gsengai/gsengai/blob/main/docs/production.md).

## Usage

```ts
import { createEvidenceStore } from "@gsengai/core";
import { createImageSigner, readManifest } from "@gsengai/c2pa";

const store = createEvidenceStore({ path: "./evidence.db" });
const signer = createImageSigner({
  store,
  systemId: "my-image-feature",
  // ⚠ explicit opt-in to the bundled DEV certificates: untrusted by public
  // validators, private key public, a one-time warning. Production passes
  // certPath + keyPath instead; with neither, createImageSigner throws.
  devCertificates: true,
});

const { record, manifestLabel } = await signer.signImage({
  input: "./generated.png",
  output: "./generated.signed.png",
  model: "gpt-image-1",
});
console.log(record); // evidence record: modality 'image', marking ['c2pa']

// Verify locally: manifest label, ingredient chain, exact validation codes,
// and signedWithDevCertificate (true here: the bundled dev certificate signed it)
console.log(await readManifest("./generated.signed.png"));
```

The manifest carries a `c2pa.created` action with `digitalSourceType: trainedAlgorithmicMedia`, the model identifier, and a timestamp. If the input already carries a C2PA manifest, `signImage` never overwrites it — the existing manifest is chained as the parent ingredient and stays resolvable. Signing and reading are fully offline: no OCSP, no remote manifest fetches, no TSA.

The bundled development certificates are **untrusted by public validators by design** and their private key is public — for integration testing only, and only when you opt in with `devCertificates: true`. For production, pass your own `certPath` and `keyPath`. Any other combination (neither, only one of the two paths, or the opt-in together with a path) throws; there is no silent fallback to the dev key. See [docs/CERTIFICATES.md](https://github.com/gsengai/gsengai/blob/main/docs/CERTIFICATES.md).

Manifests can be removed downstream by re-encoding, screenshots, or platform uploads — that is exactly why the evidence log exists.

## Positioning

This package supports compliance with EU AI Act Article 50 and California SB 942. It does not make you compliant — compliance depends on your system, your deployment context, and your processes. It is not legal advice.

## License

Apache-2.0
