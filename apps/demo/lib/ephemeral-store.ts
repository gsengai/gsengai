// SPDX-License-Identifier: Apache-2.0
// Ephemeral evidence store (ADR-0029): every request gets a fresh in-memory
// SQLite store that lives only for that request — hashes and metadata only,
// never a file on disk, closed before the response leaves. Two labeled sample
// records are seeded first so the visitor's record links into a real chain
// (non-null prev_hash) and chain verification covers more than one link.
import { createEvidenceStore, type EvidenceStore } from "@gsengai/core";
import { BRAND } from "./brand";

export const SEED_SYSTEM_ID = `${BRAND}-demo/seed`;

const SEED_TEXTS = [
  "Sample model output seeded by the demo so the chain has a genesis record.",
  "A second seeded sample output — your record will link to this one via prev_hash.",
];

/** Stores currently open — 0 between requests (asserted by test/ephemeral.test.ts). */
let openStores = 0;

export function openEphemeralStoreCount(): number {
  return openStores;
}

/**
 * Run `fn` against a seeded, request-scoped, in-memory store. The store is
 * always closed (wiped) before this returns — nothing survives the request.
 */
export async function withEphemeralStore<T>(
  fn: (store: EvidenceStore) => Promise<T> | T,
): Promise<T> {
  const store = createEvidenceStore({ path: ":memory:" });
  openStores += 1;
  try {
    for (const [i, text] of SEED_TEXTS.entries()) {
      store.append({
        modality: "text",
        model: "demo-seed",
        systemId: SEED_SYSTEM_ID,
        outputText: text,
        disclosureContext: `sample record ${i + 1} seeded by the demo`,
      });
    }
    return await fn(store);
  } finally {
    store.close();
    openStores -= 1;
  }
}
