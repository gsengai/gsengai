// SPDX-License-Identifier: Apache-2.0
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolveBackend, type SignatureInfoJson } from "./backend";
import { certificateSha256, devCertificateSha256, isReportedSigner } from "./cert";
import { manifestSigningCertificate } from "./jumbf";
import { detectImageMime, type ImageMime } from "./mime";

/** Validation status codes as reported by the C2PA validator, grouped by outcome. */
export interface ValidationStatusCodes {
  success: string[];
  informational: string[];
  failure: string[];
}

/** Summary of the C2PA manifest store embedded in an asset. */
export interface ManifestSummary {
  /** Label of the active (most recent) manifest. */
  activeLabel: string;
  /** Number of ingredients on the active manifest (parents + components). */
  ingredientCount: number;
  /**
   * Overall validation state as reported by the validator. Dev-cert-signed
   * assets report a valid signature but an untrusted credential — see
   * docs/CERTIFICATES.md; this library never claims trust it does not have.
   */
  validationState: string | null;
  /** Exact validator status codes for the active manifest. */
  validationStatusCodes: ValidationStatusCodes;
  /** All manifest labels in the store — the provenance chain, active first is not guaranteed. */
  manifestLabels: string[];
  /**
   * Whether the active manifest was signed with the bundled, untrusted
   * DEVELOPMENT certificate, matched by the leaf certificate's SHA-256
   * fingerprint against the dev chain shipped in this package (ADR-0039):
   *
   * - `true`: the signing certificate is the dev leaf.
   * - `false`: the signing certificate was determined and is not the dev leaf.
   * - `null`: the signing certificate could not be determined — no single
   *   unambiguous embedded store, an unreadable signature, or a certificate
   *   that does not match the signer the validator reported (ADR-0040). Treat
   *   null as unknown, never as "not dev-signed".
   *
   * Ingredient (parent) manifests are not considered; this says nothing about
   * signature validity — see `validationStatusCodes`.
   */
  signedWithDevCertificate: boolean | null;
}

/**
 * Read and locally validate the C2PA manifest store of a PNG/JPEG asset.
 * Returns null when the asset carries no manifest. Never fetches anything
 * remote (no OCSP, no remote manifests); trust is evaluated against local
 * configuration only.
 */
export async function readManifest(input: string | Uint8Array): Promise<ManifestSummary | null> {
  const bytes = typeof input === "string" ? await readFile(input) : Buffer.from(input);
  const mimeType = detectImageMime(bytes, "input");
  const backend = await resolveBackend();
  const store = await backend.validateStore(bytes, mimeType);
  const activeLabel = store?.active_manifest;
  if (!store || !activeLabel) {
    return null;
  }
  const active = store.manifests?.[activeLabel];
  const results = store.validation_results?.activeManifest;
  return {
    activeLabel,
    ingredientCount: active?.ingredients?.length ?? 0,
    validationState: store.validation_state ?? null,
    validationStatusCodes: {
      success: (results?.success ?? []).map((s) => s.code),
      informational: (results?.informational ?? []).map((s) => s.code),
      failure: (results?.failure ?? []).map((s) => s.code),
    },
    manifestLabels: Object.keys(store.manifests ?? {}),
    signedWithDevCertificate: signedWithDevCertificate(
      bytes,
      mimeType,
      activeLabel,
      active?.signature_info,
    ),
  };
}

/**
 * Tri-state dev-cert check (ADR-0040). The certificate is read from the
 * embedded store and must be the signer the backend reported for the
 * signature it validated (serial + organization) before its fingerprint is
 * trusted to say anything; every failure to establish that is null.
 */
function signedWithDevCertificate(
  bytes: Buffer,
  mimeType: ImageMime,
  label: string,
  reported: SignatureInfoJson | null | undefined,
): boolean | null {
  if (!reported) {
    return null; // the backend reports no signer for the signature it validated
  }
  const leaf = manifestSigningCertificate(bytes, mimeType, label);
  if (leaf === null) {
    return null;
  }
  try {
    const certificate = new X509Certificate(leaf);
    if (!isReportedSigner(certificate, reported)) {
      return null; // not provably the signature the backend validated
    }
    return certificateSha256(certificate.raw) === devCertificateSha256();
  } catch {
    return null; // unparseable certificate, or the bundled dev chain is unreadable
  }
}
