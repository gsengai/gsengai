// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { type EvidenceRecord, type EvidenceStore, type FailMode, safeAppend } from "@gsengai/core";
import { resolveBackend } from "./backend";
import { detectImageMime } from "./mime";

export { GENERATOR_ASSERTION_LABEL, TRAINED_ALGORITHMIC_MEDIA } from "./constants";

const DEV_CERT_PATH = fileURLToPath(new URL("../dev-certs/dev-cert-chain.pem", import.meta.url));
const DEV_KEY_PATH = fileURLToPath(new URL("../dev-certs/dev-private-key.pem", import.meta.url));
const CERTIFICATES_DOC = "https://github.com/gsengai/gsengai/blob/main/docs/CERTIFICATES.md";

let devCertWarningShown = false;

export interface CreateImageSignerOptions {
  store: EvidenceStore;
  /** Integrator's system/feature identifier — persisted as `system_id` (PRD §4). */
  systemId: string;
  /**
   * PEM certificate chain (leaf first). Required, together with `keyPath`,
   * unless `devCertificates` is true.
   */
  certPath?: string;
  /**
   * PKCS#8 PEM private key for the leaf certificate. Required, together with
   * `certPath`, unless `devCertificates` is true.
   */
  keyPath?: string;
  /**
   * Explicit opt-in to the bundled DEVELOPMENT certificates (ADR-0038): self-signed,
   * untrusted by public validators, private key public — integration testing only.
   * Prints a one-time warning. Cannot be combined with `certPath`/`keyPath`.
   */
  devCertificates?: boolean;
  /**
   * Path to a c2patool binary for the cross-platform fallback backend.
   * Defaults to $GSENGAI_C2PATOOL_PATH, then `c2patool` on PATH. Only
   * consulted when the native @contentauth/c2pa-node module cannot load (or
   * when GSENGAI_C2PA_BACKEND=c2patool forces the fallback).
   */
  c2patoolPath?: string;
  /**
   * Applies to evidence-store failures only (ADR-0017): `open` (default) warns,
   * counts the lost record, and still returns the signed asset; `strict` throws.
   * Signing failures always throw regardless of this setting.
   */
  failMode?: FailMode;
}

export interface SignImageOptions {
  /** Source image: file path or bytes. PNG and JPEG only (MVP). */
  input: string | Uint8Array;
  /** Destination file path. Omit to receive the signed asset as a Buffer. */
  output?: string;
  /** Model identifier that generated the image — recorded in the manifest and the evidence record. */
  model: string;
  /** Optional prompt hash (compute with `hashPrompt` from @gsengai/core). */
  promptHash?: string | null;
  disclosureContext?: string | null;
}

export interface SignImageResult {
  /** The signed asset: the `output` path when one was given, otherwise a Buffer. */
  output: string | Buffer;
  /** The appended evidence record; null only in fail-open mode when the store failed (the loss is counted). */
  record: EvidenceRecord | null;
  /** Active manifest label of the signed output, as reported by the C2PA reader (ADR-0018). */
  manifestLabel: string;
}

export interface ImageSigner {
  /**
   * Sign a PNG/JPEG with a C2PA manifest declaring AI generation and append one
   * evidence record (PRD B6). If the input already carries a manifest it is
   * preserved as the parent ingredient — never overwritten (PRD B3, ADR-0015).
   */
  signImage(options: SignImageOptions): Promise<SignImageResult>;
}

function warnDevCertificates(): void {
  if (devCertWarningShown) {
    return;
  }
  devCertWarningShown = true;
  console.warn(
    "[gsengai] Signing with the bundled DEVELOPMENT certificates (devCertificates: true): " +
      "signed manifests are UNTRUSTED by public validators and the private key is public, " +
      "so they are for integration testing only. Provide certPath/keyPath with your own " +
      `signing certificate for production — see ${CERTIFICATES_DOC}`,
  );
}

/**
 * Credential selection (ADR-0038): either both of `certPath`/`keyPath`, or
 * neither plus `devCertificates: true`. Everything else throws before any file
 * is read — there is no silent fallback to the dev key.
 */
function resolveCredentials(options: CreateImageSignerOptions): {
  certPath: string;
  keyPath: string;
} {
  const { certPath, keyPath, devCertificates } = options;
  if (devCertificates === true) {
    if (certPath !== undefined || keyPath !== undefined) {
      throw new TypeError(
        "gsengai: devCertificates: true cannot be combined with certPath/keyPath — pass your " +
          "own certPath and keyPath, or devCertificates: true alone for the bundled, untrusted " +
          `development certificates. See ${CERTIFICATES_DOC}`,
      );
    }
    warnDevCertificates();
    return { certPath: DEV_CERT_PATH, keyPath: DEV_KEY_PATH };
  }
  if (certPath !== undefined && keyPath !== undefined) {
    return { certPath, keyPath };
  }
  if (certPath !== undefined || keyPath !== undefined) {
    const [given, missing] =
      certPath !== undefined ? ["certPath", "keyPath"] : ["keyPath", "certPath"];
    throw new TypeError(
      `gsengai: ${given} was given without ${missing} — pass both your certificate chain ` +
        `(certPath) and its private key (keyPath). See ${CERTIFICATES_DOC}`,
    );
  }
  throw new TypeError(
    "gsengai: no signing certificate configured — pass certPath and keyPath for your own " +
      "certificate, or devCertificates: true to sign with the bundled, untrusted development " +
      `certificates (integration testing only). See ${CERTIFICATES_DOC}`,
  );
}

export function createImageSigner(options: CreateImageSignerOptions): ImageSigner {
  const { store, systemId, failMode } = options;
  if (typeof systemId !== "string" || systemId.length === 0) {
    throw new TypeError("gsengai: systemId must be a non-empty string");
  }
  const { certPath, keyPath } = resolveCredentials(options);
  // Read eagerly so a bad path fails at construction, not at first sign.
  const certBytes = readFileSync(certPath);
  const keyBytes = readFileSync(keyPath);

  return {
    async signImage(sign: SignImageOptions): Promise<SignImageResult> {
      if (typeof sign.model !== "string" || sign.model.length === 0) {
        throw new TypeError("gsengai: model must be a non-empty string");
      }
      const inputBytes =
        typeof sign.input === "string" ? await readFile(sign.input) : Buffer.from(sign.input);
      const mimeType = detectImageMime(inputBytes, "signImage input");

      const backend = await resolveBackend(options.c2patoolPath);
      // ADR-0015 intent mapping: existing manifest → edit + parent ingredient
      // (chained, never overwritten); none → create + trainedAlgorithmicMedia.
      const existing = await backend.peekStore(inputBytes, mimeType);
      const title =
        sign.output !== undefined
          ? basename(sign.output)
          : typeof sign.input === "string"
            ? basename(sign.input)
            : mimeType === "image/png"
              ? "image.png"
              : "image.jpg";

      // Signing failures always throw (ADR-0017) — nothing to fail open with.
      const { signedBytes, manifestLabel } = await backend.sign({
        inputBytes,
        mimeType,
        outputPath: sign.output,
        title,
        model: sign.model,
        when: new Date().toISOString(),
        hasParent: existing?.active_manifest != null,
        certBytes,
        keyBytes,
        certPath,
        keyPath,
      });
      const output: string | Buffer = sign.output ?? signedBytes;

      // Evidence-store failures follow failMode (ADR-0017); output_hash is the
      // sha256 of the signed output bytes, hashed centrally in core (ADR-0018).
      const record = safeAppend(
        store,
        {
          modality: "image",
          model: sign.model,
          systemId,
          outputBytes: signedBytes,
          manifestRef: manifestLabel,
          markingMethods: ["c2pa"],
          promptHash: sign.promptHash ?? null,
          disclosureContext: sign.disclosureContext ?? null,
        },
        failMode,
      );

      return { output, record, manifestLabel };
    },
  };
}
