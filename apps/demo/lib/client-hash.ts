// SPDX-License-Identifier: Apache-2.0
// Browser-side hashing (ADR-0029): normalization (PRD §5 v1) and SHA-256 run
// with Web Crypto in the visitor's browser, so raw text never leaves it — the
// server only ever receives hashes. This module must stay importable in the
// client bundle: no Node built-ins, no @gsengai/* imports. Parity with
// @gsengai/core's `hashText` is pinned by test (test/hash-parity.test.ts).

/** Mirrors HASH_VERSION in @gsengai/core (spec §5 v1) — parity-tested. */
export const CLIENT_HASH_VERSION = 1;

/**
 * Text normalization spec v1 (PRD §5), same steps in the same order as
 * @gsengai/core: NFC → toLowerCase → collapse whitespace runs → trim.
 */
export function normalizeTextClient(raw: string): string {
  return raw.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** SHA-256 hex digest of a UTF-8 string via Web Crypto. */
export async function sha256HexClient(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ClientTextHashes {
  outputHash: string;
  outputHashNormalized: string;
  hashVersion: number;
}

/** Hash a text per PRD §5 — the exact payload the demo submits instead of the text. */
export async function hashTextClient(raw: string): Promise<ClientTextHashes> {
  const [outputHash, outputHashNormalized] = await Promise.all([
    sha256HexClient(raw),
    sha256HexClient(normalizeTextClient(raw)),
  ]);
  return { outputHash, outputHashNormalized, hashVersion: CLIENT_HASH_VERSION };
}
