// SPDX-License-Identifier: Apache-2.0
// Upgrade compatibility (ADR-0039). fixtures/store-core-0.2.1.db was written
// by the unmodified @gsengai/core 0.2.1, before signer_cert_sha256 existed.
// Opening it with the current code must add the column without touching any
// existing row, every existing record_hash must still verify, and the chain
// must extend across the upgrade. The fixture is never opened in place: every
// test works on a copy, and its bytes are pinned.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceStore, sha256Hex } from "@gsengai/core";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OPEN_STORE = fileURLToPath(new URL("./helpers/open-store.ts", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/store-core-0.2.1.db", import.meta.url));
const FIXTURE_SHA256 = "1923e10692a2e8ab7c8111b0f781483c8951a107cbce4f50546661d3903d3408";
const PRE_UPGRADE_COLUMNS = [
  "seq",
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
];

type Row = Record<string, unknown>;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-upgrade-"));
  dbPath = join(dir, "evidence.db");
  // Bytes, not copyFileSync: the copy must be writable whatever the fixture's mode.
  writeFileSync(dbPath, readFileSync(FIXTURE));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Raw table state through a separate connection — bypasses the store API entirely. */
function snapshot(path: string): { columns: string[]; rows: Row[] } {
  const raw = new Database(path, { readonly: true });
  try {
    const columns = (raw.prepare("PRAGMA table_info(evidence)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    const rows = raw.prepare("SELECT * FROM evidence ORDER BY seq").all() as Row[];
    return { columns, rows };
  } finally {
    raw.close();
  }
}

describe("upgrading a store written before signer_cert_sha256 (ADR-0039)", () => {
  it("the fixture is the pinned 0.2.1-written file: 4 records, no signer column", () => {
    expect(sha256Hex(readFileSync(FIXTURE))).toBe(FIXTURE_SHA256);
    const before = snapshot(dbPath);
    expect(before.columns).toEqual(PRE_UPGRADE_COLUMNS);
    expect(before.rows.map((r) => r.modality)).toEqual(["text", "text", "image", "text"]);
  });

  it("opening adds the column without modifying any existing row, and verifyChain passes", () => {
    const before = snapshot(dbPath);

    const store = createEvidenceStore({ path: dbPath });
    expect(store.verifyChain()).toEqual({ ok: true, checked: 4 });
    const records = store.findByOutputHash(before.rows[2]?.output_hash as string);
    expect(records).toHaveLength(1);
    expect(records[0]?.signer_cert_sha256).toBeNull();
    store.close();

    const after = snapshot(dbPath);
    expect(after.columns).toEqual([...PRE_UPGRADE_COLUMNS, "signer_cert_sha256"]);
    // Every pre-existing value — record_hash included — is byte-identical.
    expect(after.rows).toEqual(before.rows.map((row) => ({ ...row, signer_cert_sha256: null })));
  });

  it("appends a record with the new field set, and the chain verifies before and after — also across reopen", () => {
    const before = snapshot(dbPath);
    const lastHash = before.rows.at(-1)?.record_hash;

    let store = createEvidenceStore({ path: dbPath });
    expect(store.verifyChain()).toEqual({ ok: true, checked: 4 });
    const signed = store.append({
      modality: "image",
      model: "post-upgrade-image-model",
      systemId: "post-upgrade-system",
      outputBytes: Buffer.from("post-upgrade signed image bytes"),
      manifestRef: "urn:c2pa:post-upgrade-label",
      markingMethods: ["c2pa"],
      signerCertSha256: sha256Hex("post-upgrade leaf certificate DER"),
    });
    expect(signed.prev_hash).toBe(lastHash);
    expect(signed.signer_cert_sha256).toBe(sha256Hex("post-upgrade leaf certificate DER"));
    store.append({ modality: "text", model: "m", systemId: "s", outputText: "post-upgrade text" });
    expect(store.verifyChain()).toEqual({ ok: true, checked: 6 });
    store.close();

    // Reopening is idempotent: no second migration, nothing rewritten.
    store = createEvidenceStore({ path: dbPath });
    expect(store.verifyChain()).toEqual({ ok: true, checked: 6 });
    store.close();
    const after = snapshot(dbPath);
    expect(after.columns).toEqual([...PRE_UPGRADE_COLUMNS, "signer_cert_sha256"]);
    expect(after.rows.slice(0, 4)).toEqual(
      before.rows.map((row) => ({ ...row, signer_cert_sha256: null })),
    );
  });

  it("two processes racing to upgrade the same store both succeed", () => {
    // Deterministic interleaving of the race window: this opener has run its
    // column check (column missing) when a second process opens the same
    // store, adds the column, and exits — only then does this opener continue
    // to its migration step. Without the re-check under the write lock it
    // failed here with "duplicate column name: signer_cert_sha256".
    const before = snapshot(dbPath);
    let competitor: string | null = null;
    const prepare = Database.prototype.prepare;
    const spy = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
      this: Database.Database,
      source: string,
    ) {
      const statement = prepare.call(this, source);
      if (competitor !== null || source !== "PRAGMA table_info(evidence)") {
        return statement;
      }
      const all = statement.all.bind(statement) as (...params: unknown[]) => unknown[];
      return Object.assign(statement, {
        all: (...params: unknown[]) => {
          const rows = all(...params);
          competitor ??= execFileSync(process.execPath, ["--import", "tsx", OPEN_STORE, dbPath], {
            cwd: REPO_ROOT,
            encoding: "utf8",
          });
          return rows;
        },
      });
    });

    let store: ReturnType<typeof createEvidenceStore>;
    try {
      store = createEvidenceStore({ path: dbPath });
    } finally {
      spy.mockRestore();
    }
    // The second process really ran inside the race window, and migrated the store.
    expect(JSON.parse(competitor ?? "null")).toEqual({ ok: true, checked: 4 });

    expect(store.verifyChain()).toEqual({ ok: true, checked: 4 });
    store.append({ modality: "text", model: "m", systemId: "s", outputText: "after the race" });
    expect(store.verifyChain()).toEqual({ ok: true, checked: 5 });
    store.close();

    const after = snapshot(dbPath);
    expect(after.columns).toEqual([...PRE_UPGRADE_COLUMNS, "signer_cert_sha256"]);
    expect(after.rows.slice(0, 4)).toEqual(
      before.rows.map((row) => ({ ...row, signer_cert_sha256: null })),
    );
  });

  it("the committed fixture is never modified by these tests", () => {
    expect(sha256Hex(readFileSync(FIXTURE))).toBe(FIXTURE_SHA256);
  });
});
