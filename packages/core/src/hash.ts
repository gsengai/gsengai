// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";

/** Version of the text normalization spec (PRD §5) used for `output_hash_normalized`. */
export const HASH_VERSION = 1;

/** SHA-256 hex digest of a UTF-8 string or raw bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof data === "string") {
    hash.update(data, "utf8");
  } else {
    hash.update(data);
  }
  return hash.digest("hex");
}

/**
 * Text normalization spec v1 (PRD §5), applied in exactly this order:
 * 1. Unicode NFC normalize
 * 2. toLowerCase()
 * 3. Collapse every whitespace run to a single space (U+0020)
 * 4. Trim
 */
export function normalizeText(raw: string): string {
  return raw.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export interface TextHashes {
  /** SHA-256 of the raw output text. */
  outputHash: string;
  /** SHA-256 of the normalized text (spec §5). */
  outputHashNormalized: string;
  hashVersion: number;
}

/** Hash a generated text per PRD §5. The text is only read in memory — never persisted. */
export function hashText(raw: string): TextHashes {
  return {
    outputHash: sha256Hex(raw),
    outputHashNormalized: sha256Hex(normalizeText(raw)),
    hashVersion: HASH_VERSION,
  };
}
