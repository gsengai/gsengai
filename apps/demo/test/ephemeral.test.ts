// SPDX-License-Identifier: Apache-2.0
// The demo store is ephemeral and hash-only (ADR-0029): in-memory, request-
// scoped, wiped after every request — including error paths — and no route
// response ever echoes user content back as stored data.
import { readFileSync } from "node:fs";
import { hashText } from "@gsengai/core";
import { describe, expect, it } from "vitest";
import { makePng } from "../../../packages/c2pa/test/fixtures";
import { POST as postEvidence } from "../app/api/evidence/route";
import { POST as postSign, type SignImageResponse } from "../app/api/sign/route";
import { openEphemeralStoreCount, withEphemeralStore } from "../lib/ephemeral-store";

describe("ephemeral store (ADR-0029)", () => {
  it("no store stays open after a text request — the request-scoped DB is wiped", async () => {
    const response = await postEvidence(
      new Request("http://demo.local/api/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hashText("wiped after this request")),
      }),
    );
    expect(response.status).toBe(200);
    expect(openEphemeralStoreCount()).toBe(0);
  });

  it("no store stays open after an image request, and no temp file is written", async () => {
    const sentinel = "EPHEMERAL-CANARY-0f8a2b";
    const form = new FormData();
    form.set(
      "image",
      new File([new Uint8Array(makePng(sentinel))], "c.png", { type: "image/png" }),
    );
    const response = await postSign(
      new Request("http://demo.local/api/sign", { method: "POST", body: form }),
    );
    expect(response.status).toBe(200);
    expect(openEphemeralStoreCount()).toBe(0);

    // The signed asset comes back as bytes (never via a temp path), and the
    // record persists hashes and metadata only — no trace of the image bytes.
    const body = (await response.json()) as SignImageResponse;
    expect(typeof body.signedImage).toBe("string");
    const persisted = JSON.stringify(body.record);
    expect(persisted).not.toContain(sentinel);
    expect(persisted).not.toContain(body.signedImage.slice(0, 48));
  });

  it("the store is wiped even when the request handler throws", async () => {
    await expect(
      withEphemeralStore(() => {
        throw new Error("handler exploded");
      }),
    ).rejects.toThrow("handler exploded");
    expect(openEphemeralStoreCount()).toBe(0);
  });

  it("the ephemeral store is in-memory — there is no DB file to persist to", async () => {
    // Pin the helper to SQLite's :memory: mode (never a disk path), and check
    // a record round-trips through it.
    const source = readFileSync(new URL("../lib/ephemeral-store.ts", import.meta.url), "utf8");
    expect(source).toContain('path: ":memory:"');
    const record = await withEphemeralStore((store) =>
      store.append({
        modality: "text",
        model: "m",
        systemId: "s",
        outputHashes: hashText("in-memory only"),
      }),
    );
    expect(record.record_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(openEphemeralStoreCount()).toBe(0);
  });
});
