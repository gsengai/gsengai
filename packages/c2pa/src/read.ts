// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { resolveBackend } from "./backend";
import { detectImageMime } from "./mime";

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
  };
}
