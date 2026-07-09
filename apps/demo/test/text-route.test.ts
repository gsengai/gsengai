// SPDX-License-Identifier: Apache-2.0
// Text-flow route: a hashes-only payload yields a schema-complete §4 record in
// a verified chain — and anything that could carry raw content is rejected.
import { hashText } from "@gsengai/core";
import { describe, expect, it } from "vitest";
import { POST, type TextEvidenceResponse } from "../app/api/evidence/route";

const SHA256_HEX = /^[0-9a-f]{64}$/;

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://demo.local/api/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/evidence (text flow)", () => {
  it("returns a schema-complete §4 record for a submitted hash payload; chain verifies", async () => {
    const hashes = hashText("The demo never sees this text — only these hashes.");
    const response = await post({
      outputHash: hashes.outputHash,
      outputHashNormalized: hashes.outputHashNormalized,
      hashVersion: hashes.hashVersion,
    });
    expect(response.status).toBe(200);
    const { record, chain } = (await response.json()) as TextEvidenceResponse;

    // Every §4 field, exactly as persisted.
    expect(Object.keys(record).sort()).toEqual(
      [
        "id",
        "ts",
        "modality",
        "model",
        "system_id",
        "prompt_hash",
        "output_hash",
        "output_hash_normalized",
        "hash_version",
        "marking_methods",
        "manifest_ref",
        "disclosure_context",
        "prev_hash",
        "record_hash",
      ].sort(),
    );
    expect(record.modality).toBe("text");
    expect(record.system_id).toBe("gsengai-demo/text-flow");
    expect(record.output_hash).toBe(hashes.outputHash);
    expect(record.output_hash_normalized).toBe(hashes.outputHashNormalized);
    expect(record.hash_version).toBe(1);
    expect(record.marking_methods).toEqual(["logging"]);
    expect(record.manifest_ref).toBeNull();
    expect(record.record_hash).toMatch(SHA256_HEX);
    // Seeded chain: the visitor's record links to a predecessor.
    expect(record.prev_hash).toMatch(SHA256_HEX);
    expect(chain).toEqual({ ok: true, checked: 3 });
  });

  it("rejects any payload carrying raw content — hashes only ever reach the server", async () => {
    const hashes = hashText("sample");
    for (const extra of [
      { text: "raw text smuggled in" },
      { outputText: "raw text smuggled in" },
      { prompt: "a raw prompt" },
    ]) {
      const response = await post({ ...hashes, ...extra });
      expect(response.status).toBe(400);
      const { error } = (await response.json()) as { error: string };
      expect(error).toContain("hashes only");
    }
  });

  it("rejects malformed hashes, wrong hash_version, and non-JSON bodies", async () => {
    const good = hashText("sample");
    expect((await post({ ...good, outputHash: "not-a-hash" })).status).toBe(400);
    expect((await post({ ...good, outputHashNormalized: "ABCD" })).status).toBe(400);
    expect((await post({ ...good, hashVersion: 2 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post([1, 2, 3])).status).toBe(400);
  });
});
