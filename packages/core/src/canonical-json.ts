// SPDX-License-Identifier: Apache-2.0
import { sha256Hex } from "./hash";

/**
 * Canonical JSON (PRD §4): recursively key-sorted objects, arrays kept in order,
 * no insignificant whitespace, UTF-8. Deterministic for any JSON-serializable value.
 * Non-serializable values (cycles, BigInt) throw, as with `JSON.stringify`.
 */
export function canonicalJson(value: unknown): string {
  const out = JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        sorted[key] = record[key];
      }
      return sorted;
    }
    return val;
  });
  if (out === undefined) {
    throw new TypeError("canonicalJson: value does not serialize to JSON");
  }
  return out;
}

/** `sha256(canonicalJson(messagesOrInput))` — the prompt fingerprint of PRD §4. */
export function hashPrompt(messagesOrInput: unknown): string {
  return sha256Hex(canonicalJson(messagesOrInput));
}
