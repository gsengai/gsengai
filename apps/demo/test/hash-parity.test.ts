// SPDX-License-Identifier: Apache-2.0
// The browser-side hashing (Web Crypto + the §5 port) must produce exactly the
// hashes @gsengai/core computes server-side — otherwise detection lookups on
// demo-produced records would silently miss.
import { HASH_VERSION, hashText, normalizeText } from "@gsengai/core";
import { describe, expect, it } from "vitest";
import { CLIENT_HASH_VERSION, hashTextClient, normalizeTextClient } from "../lib/client-hash";

const SAMPLES = [
  "Hello, World!",
  "  Weird   whitespace\t\n\r\n  and trailing   ",
  "MIXED case With ÜMLAUTS and emoji 🧾✅",
  "Café — composed é vs decomposed é, plus non-breaking spaces",
  "多语言テキスト مرحبا мир",
  "one-word",
  "",
];

describe("client-side hashing parity with @gsengai/core (ADR-0029)", () => {
  it("hash version matches the §5 spec version", () => {
    expect(CLIENT_HASH_VERSION).toBe(HASH_VERSION);
  });

  it("normalization matches core for every sample", () => {
    for (const sample of SAMPLES) {
      expect(normalizeTextClient(sample)).toBe(normalizeText(sample));
    }
  });

  it("output_hash and output_hash_normalized match core for every sample", async () => {
    for (const sample of SAMPLES) {
      const client = await hashTextClient(sample);
      const core = hashText(sample);
      expect(client.outputHash).toBe(core.outputHash);
      expect(client.outputHashNormalized).toBe(core.outputHashNormalized);
      expect(client.hashVersion).toBe(core.hashVersion);
    }
  });
});
