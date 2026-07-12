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

let devCertWarningShown = false;

export interface CreateImageSignerOptions {
  store: EvidenceStore;
  /** Integrator's system/feature identifier — persisted as `system_id` (PRD §4). */
  systemId: string;
  /** PEM certificate chain (leaf first). Defaults to the bundled DEV certificates. */
  certPath?: string;
  /** PKCS#8 PEM private key for the leaf certificate. Defaults to the bundled DEV key. */
  keyPath?: string;
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

function warnIfDevCerts(certPath: string | undefined, keyPath: string | undefined): void {
  if ((certPath && keyPath) || devCertWarningShown) {
    return;
  }
  devCertWarningShown = true;
  console.warn(
    "[gsengai] Using the bundled DEVELOPMENT certificates: signed manifests are UNTRUSTED " +
      "by public validators and are for integration testing only. Provide certPath/keyPath " +
      "with your own signing certificate for production — see docs/CERTIFICATES.md.",
  );
}

export function createImageSigner(options: CreateImageSignerOptions): ImageSigner {
  const { store, systemId, failMode } = options;
  if (typeof systemId !== "string" || systemId.length === 0) {
    throw new TypeError("gsengai: systemId must be a non-empty string");
  }
  warnIfDevCerts(options.certPath, options.keyPath);
  const certPath = options.certPath ?? DEV_CERT_PATH;
  const keyPath = options.keyPath ?? DEV_KEY_PATH;
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
