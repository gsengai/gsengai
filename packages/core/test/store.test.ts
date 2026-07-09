// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEvidenceStore,
  type EvidenceStore,
  hashPrompt,
  hashText,
  NotImplementedError,
  sha256Hex,
} from "@gsengai/core";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let dir: string;
let dbPath: string;
let store: EvidenceStore;
let open = false;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-store-"));
  dbPath = join(dir, "evidence.db");
  store = createEvidenceStore({ path: dbPath });
  open = true;
});

afterEach(() => {
  if (open) {
    store.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

function appendText(text: string, extra: { promptHash?: string | null } = {}) {
  return store.append({
    modality: "text",
    model: "test-model-1",
    systemId: "test-system",
    outputText: text,
    ...extra,
  });
}

describe("evidence store — append (PRD §4)", () => {
  it("append returns a schema-complete v1 record", () => {
    const promptHash = hashPrompt([{ role: "user", content: "hello" }]);
    const record = appendText("Hello World", { promptHash });

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
    expect(record.id).toMatch(UUID);
    expect(Number.isNaN(Date.parse(record.ts))).toBe(false);
    expect(record.ts.endsWith("Z")).toBe(true); // ISO 8601 UTC
    expect(record.modality).toBe("text");
    expect(record.model).toBe("test-model-1");
    expect(record.system_id).toBe("test-system");
    expect(record.prompt_hash).toBe(promptHash);
    expect(record.output_hash).toBe(sha256Hex("Hello World"));
    expect(record.output_hash_normalized).toBe(sha256Hex("hello world"));
    expect(record.hash_version).toBe(1);
    expect(record.marking_methods).toEqual(["logging"]);
    expect(record.manifest_ref).toBeNull();
    expect(record.disclosure_context).toBeNull();
    expect(record.prev_hash).toBeNull(); // genesis record
    expect(record.record_hash).toMatch(HEX64);
  });

  it("accepts precomputed output hashes", () => {
    const hashes = hashText("precomputed content");
    const record = store.append({
      modality: "text",
      model: "test-model-1",
      systemId: "test-system",
      outputHashes: hashes,
    });
    expect(record.output_hash).toBe(hashes.outputHash);
    expect(record.output_hash_normalized).toBe(hashes.outputHashNormalized);
    expect(record.hash_version).toBe(1);
    expect(store.findByText("precomputed content").map((r) => r.id)).toContain(record.id);
  });

  it("validates input: systemId, model, modality, and the text/hashes choice", () => {
    const base = { modality: "text" as const, model: "m", systemId: "s" };
    expect(() => store.append({ ...base, systemId: "", outputText: "x" })).toThrow(TypeError);
    expect(() => store.append({ ...base, model: "", outputText: "x" })).toThrow(TypeError);
    expect(() => store.append({ ...base, modality: "hologram" as never, outputText: "x" })).toThrow(
      TypeError,
    );
    expect(() => store.append({ ...base } as never)).toThrow(/exactly one of/);
    expect(() =>
      store.append({ ...base, outputText: "x", outputHashes: hashText("x") } as never),
    ).toThrow(/exactly one of/);
  });

  it("appends image evidence from outputBytes: hash of the bytes, no normalized hash (ADR-0018)", () => {
    const bytes = Buffer.from("fake signed image bytes");
    const record = store.append({
      modality: "image",
      model: "test-image-model",
      systemId: "test-system",
      outputBytes: bytes,
      manifestRef: "urn:c2pa:test-label",
      markingMethods: ["c2pa"],
    });
    expect(record.modality).toBe("image");
    expect(record.output_hash).toBe(sha256Hex(bytes));
    expect(record.output_hash_normalized).toBeNull();
    expect(record.manifest_ref).toBe("urn:c2pa:test-label");
    expect(record.marking_methods).toEqual(["c2pa"]);
    expect(store.findByOutputHash(sha256Hex(bytes)).map((r) => r.id)).toContain(record.id);
  });

  it("rejects outputBytes combined with outputText or outputHashes", () => {
    const base = { modality: "image" as const, model: "m", systemId: "s" };
    const bytes = Buffer.from("b");
    expect(() => store.append({ ...base, outputBytes: bytes, outputText: "x" } as never)).toThrow(
      /exactly one of/,
    );
    expect(() =>
      store.append({ ...base, outputBytes: bytes, outputHashes: hashText("x") } as never),
    ).toThrow(/exactly one of/);
  });

  it("storeRawContent throws NotImplementedError (PRD C4 privacy default)", () => {
    expect(() => createEvidenceStore({ path: join(dir, "raw.db"), storeRawContent: true })).toThrow(
      NotImplementedError,
    );
  });
});

describe("evidence store — tamper-evident chain (PRD C2)", () => {
  it("chain is valid over N appends and links prev_hash correctly", () => {
    const records = ["one", "two", "three", "four", "five"].map((t) => appendText(t));
    for (let i = 1; i < records.length; i += 1) {
      expect(records[i]?.prev_hash).toBe(records[i - 1]?.record_hash);
    }
    expect(store.verifyChain()).toEqual({ ok: true, checked: 5 });
    expect(store.count()).toBe(5);
  });

  it("verifyChain reports the first forged row (raw INSERT with a bad record_hash)", () => {
    appendText("legit one");
    const last = appendText("legit two");

    // Forge a row through a second raw connection — INSERT is the only writable path.
    const raw = new Database(dbPath);
    raw
      .prepare(
        `INSERT INTO evidence (
          id, ts, modality, model, system_id, prompt_hash, output_hash,
          output_hash_normalized, hash_version, marking_methods, manifest_ref,
          disclosure_context, prev_hash, record_hash
        ) VALUES (?, ?, 'text', 'forged-model', 'forged-system', NULL, ?, NULL, 1, '["logging"]', NULL, NULL, ?, ?)`,
      )
      .run(
        randomUUID(),
        new Date().toISOString(),
        sha256Hex("forged"),
        last.record_hash,
        "0".repeat(64),
      );
    raw.close();

    const result = store.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.checked).toBe(3);
    expect(result.brokenAtSeq).toBe(3);
  });

  it("verifyChain reports a broken prev_hash link even when the record_hash itself is well-formed", () => {
    appendText("first");
    appendText("second");

    // A row whose record_hash verifies but whose prev_hash skips the chain head.
    const raw = new Database(dbPath);
    const body = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      modality: "text",
      model: "m",
      system_id: "s",
      prompt_hash: null,
      output_hash: sha256Hex("spliced"),
      output_hash_normalized: null,
      hash_version: 1,
      marking_methods: ["logging"],
      manifest_ref: null,
      disclosure_context: null,
      prev_hash: null, // pretends to be a genesis record
    };
    const keys = Object.keys(body).sort() as Array<keyof typeof body>;
    const canonical = JSON.stringify(Object.fromEntries(keys.map((k) => [k, body[k]])));
    raw
      .prepare(
        `INSERT INTO evidence (
          id, ts, modality, model, system_id, prompt_hash, output_hash,
          output_hash_normalized, hash_version, marking_methods, manifest_ref,
          disclosure_context, prev_hash, record_hash
        ) VALUES (@id, @ts, @modality, @model, @system_id, @prompt_hash, @output_hash,
          @output_hash_normalized, @hash_version, @marking_methods, @manifest_ref,
          @disclosure_context, @prev_hash, @record_hash)`,
      )
      .run({
        ...body,
        marking_methods: JSON.stringify(body.marking_methods),
        record_hash: sha256Hex(canonical),
      });
    raw.close();

    const result = store.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });

  it("chain continues across close/reopen of the same file", () => {
    appendText("before close 1");
    const beforeClose = appendText("before close 2");
    store.close();
    open = false;

    store = createEvidenceStore({ path: dbPath });
    open = true;
    const afterReopen = appendText("after reopen");
    expect(afterReopen.prev_hash).toBe(beforeClose.record_hash);
    expect(store.verifyChain()).toEqual({ ok: true, checked: 3 });
  });
});

describe("evidence store — append-only enforcement (PRD C1)", () => {
  it("raw SQL UPDATE is aborted by trigger", () => {
    appendText("immutable");
    const raw = new Database(dbPath);
    expect(() => raw.prepare("UPDATE evidence SET model = 'tampered'").run()).toThrow(
      /append-only/,
    );
    raw.close();
    expect(store.verifyChain().ok).toBe(true);
  });

  it("raw SQL DELETE is aborted by trigger", () => {
    appendText("undeletable");
    const raw = new Database(dbPath);
    expect(() => raw.prepare("DELETE FROM evidence").run()).toThrow(/append-only/);
    raw.close();
    expect(store.count()).toBe(1);
  });
});

describe("evidence store — lookups (PRD A5)", () => {
  it("findByText finds an exact match", () => {
    const record = appendText("The quick Brown Fox jumps.");
    appendText("unrelated content");
    const hits = store.findByText("The quick Brown Fox jumps.");
    expect(hits.map((r) => r.id)).toContain(record.id);
    expect(store.findByText("never recorded")).toEqual([]);
  });

  it("findByText finds case- and whitespace-edited text via the normalized hash", () => {
    const record = appendText("The quick Brown Fox jumps.");
    const edited = "  the   QUICK brown\nfox jumps. ";
    const hits = store.findByText(edited);
    expect(hits.map((r) => r.id)).toContain(record.id);
    // Raw hashes differ, so this hit can only come from the normalized lookup.
    expect(sha256Hex(edited)).not.toBe(record.output_hash);
  });

  it("findByOutputHash matches on the exact raw hash", () => {
    const record = appendText("exact hash lookup target");
    expect(store.findByOutputHash(record.output_hash).map((r) => r.id)).toEqual([record.id]);
    expect(store.findByOutputHash(sha256Hex("something else"))).toEqual([]);
  });
});

describe("evidence store — JSONL export (PRD C3)", () => {
  it("exports all records and round-trips content", async () => {
    const records = ["alpha", "beta", "gamma"].map((t) => appendText(t));
    const outPath = join(dir, "export.jsonl");
    const result = await store.exportJsonl(outPath);
    expect(result).toEqual({ records: 3, path: outPath });

    const lines = readFileSync(outPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed).toEqual(records);
  });
});

describe("evidence store — privacy canary (PRD C4). Never delete, skip, or weaken this test.", () => {
  it("raw output and prompt text never appear in the database file bytes", () => {
    const outputSentinel = `CANARY-RAW-OUTPUT-${"cafedeadbeef"}-do-not-persist`;
    const promptSentinel = `CANARY-RAW-PROMPT-${"feedfacecafe"}-do-not-persist`;

    const record = store.append({
      modality: "text",
      model: "canary-model",
      systemId: "canary-system",
      outputText: `Some generated answer containing ${outputSentinel} in the middle.`,
      promptHash: hashPrompt([{ role: "user", content: promptSentinel }]),
    });
    // A few more writes so pages get flushed and reused.
    appendText("filler one");
    appendText("filler two");
    store.close();
    open = false;

    const bytes: Buffer[] = [readFileSync(dbPath)];
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) {
        bytes.push(readFileSync(dbPath + suffix));
      }
    }
    const all = Buffer.concat(bytes);

    // Positive control: the file really does contain this record's hash…
    expect(all.includes(record.output_hash, 0, "utf8")).toBe(true);
    // …but no raw content, in any journal file.
    expect(all.includes(outputSentinel, 0, "utf8")).toBe(false);
    expect(all.includes(promptSentinel, 0, "utf8")).toBe(false);
  });
});
