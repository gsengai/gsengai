// SPDX-License-Identifier: Apache-2.0
// CSV export + human-readable audit report. The privacy canary
// extension in here (no raw bytes in any export) is law: never delete, skip,
// or weaken it (PRD C4).
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CSV_COLUMNS,
  createEvidenceStore,
  type EvidenceRecord,
  type EvidenceStore,
  sha256Hex,
} from "@gsengai/core";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let dbPath: string;
let store: EvidenceStore;
let open = false;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-export-"));
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

function appendText(
  text: string,
  extra: { systemId?: string; model?: string } = {},
): EvidenceRecord {
  return store.append({
    modality: "text",
    model: extra.model ?? "test-model-1",
    systemId: extra.systemId ?? "test-system",
    outputText: text,
  });
}

function appendImage(bytes: Uint8Array, manifestRef: string): EvidenceRecord {
  return store.append({
    modality: "image",
    model: "test-image-model",
    systemId: "image-system",
    outputBytes: bytes,
    manifestRef,
    markingMethods: ["c2pa"],
  });
}

/** Minimal RFC 4180 line parser for round-trip assertions. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

async function readCsv(filter?: Parameters<EvidenceStore["exportCsv"]>[1]): Promise<{
  header: string[];
  rows: string[][];
  raw: string;
  records: number;
}> {
  const path = join(dir, `export-${randomUUID()}.csv`);
  const result = await store.exportCsv(path, filter);
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const [headerLine, ...rowLines] = lines;
  return {
    header: parseCsvLine(headerLine ?? ""),
    rows: rowLines.map(parseCsvLine),
    raw,
    records: result.records,
  };
}

describe("CSV export (PRD C3)", () => {
  it("round-trips: header row, fixed §4 column order, one row per record, fields match", async () => {
    const records = ["alpha", "beta", "gamma"].map((t) => appendText(t));
    const { header, rows, records: count } = await readCsv();

    expect(count).toBe(3);
    expect(rows).toHaveLength(3);
    expect(header).toEqual([...CSV_COLUMNS]);

    const known = records[1] as EvidenceRecord;
    const row = rows[1] as string[];
    const field = (name: string): string => row[header.indexOf(name)] as string;
    expect(field("id")).toBe(known.id);
    expect(field("ts")).toBe(known.ts);
    expect(field("modality")).toBe("text");
    expect(field("model")).toBe(known.model);
    expect(field("system_id")).toBe(known.system_id);
    expect(field("prompt_hash")).toBe(""); // null -> empty field
    expect(field("output_hash")).toBe(known.output_hash);
    expect(field("output_hash_normalized")).toBe(known.output_hash_normalized);
    expect(field("hash_version")).toBe("1");
    expect(field("marking_methods")).toBe('["logging"]');
    expect(field("manifest_ref")).toBe("");
    expect(field("prev_hash")).toBe(known.prev_hash);
    expect(field("record_hash")).toBe(known.record_hash);
  });

  it("system_id filter returns only matching rows", async () => {
    appendText("a", { systemId: "sys-a" });
    appendText("b", { systemId: "sys-b" });
    appendText("c", { systemId: "sys-a" });

    const { rows, header, records } = await readCsv({ systemId: "sys-a" });
    expect(records).toBe(2);
    const idx = header.indexOf("system_id");
    expect(rows.map((r) => r[idx])).toEqual(["sys-a", "sys-a"]);
  });

  it("date-range filter bounds inclusively on both ends", async () => {
    // Space the appends so each record gets a distinct millisecond `ts`.
    const tick = async (): Promise<void> => {
      const start = Date.now();
      while (Date.now() <= start) {
        await new Promise((r) => setTimeout(r, 1));
      }
    };
    const r1 = appendText("one");
    await tick();
    const r2 = appendText("two");
    await tick();
    const r3 = appendText("three");

    const exact = await readCsv({ since: r2.ts, until: r2.ts });
    expect(exact.rows.map((r) => r[0])).toEqual([r2.id]);

    const tail = await readCsv({ since: r2.ts });
    expect(tail.rows.map((r) => r[0])).toEqual([r2.id, r3.id]);

    const head = await readCsv({ until: r2.ts });
    expect(head.rows.map((r) => r[0])).toEqual([r1.id, r2.id]);
  });

  it("rejects an unparseable date filter and an unknown modality filter", async () => {
    appendText("x");
    await expect(store.exportCsv(join(dir, "bad.csv"), { since: "not-a-date" })).rejects.toThrow(
      TypeError,
    );
    await expect(
      store.exportCsv(join(dir, "bad.csv"), { modality: "hologram" as never }),
    ).rejects.toThrow(TypeError);
  });
});

describe("audit report (PRD C3)", () => {
  it("Integrity section states verified with the correct whole-store count", () => {
    ["one", "two", "three", "four"].map((t) => appendText(t));
    const report = store.buildAuditReport();
    expect(report.integrity).toEqual({ ok: true, checked: 4 });
    expect(report.markdown).toContain("## Integrity");
    expect(report.markdown).toContain("**Chain verified** — 4 record(s) checked");
  });

  it("broken chain: the report still renders AND Integrity reports BROKEN at the right seq", () => {
    appendText("legit one");
    const last = appendText("legit two");

    // Forge a row through a raw connection — INSERT is the only writable path.
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

    const report = store.buildAuditReport();
    // Never-hide-tampering guarantee: renders fully, break is prominent.
    expect(report.markdown.startsWith("# Evidence audit report")).toBe(true);
    expect(report.markdown).toContain("## Records");
    expect(report.integrity.ok).toBe(false);
    expect(report.markdown).toContain("BROKEN at seq 3");
    expect(report.markdown).not.toContain("Chain verified");
  });

  it("Summary breakdowns match a seeded modality/model/system_id/marking mix", () => {
    appendText("t1", { systemId: "sys-a", model: "model-x" });
    appendText("t2", { systemId: "sys-a", model: "model-x" });
    appendText("t3", { systemId: "sys-b", model: "model-y" });
    appendImage(Buffer.from("img-bytes"), "urn:c2pa:label-1");

    const { markdown } = store.buildAuditReport();
    expect(markdown).toContain("- Records (after filter): 4");
    expect(markdown).toContain("| text | 3 |");
    expect(markdown).toContain("| image | 1 |");
    expect(markdown).toContain("| model-x | 2 |");
    expect(markdown).toContain("| model-y | 1 |");
    expect(markdown).toContain("| test-image-model | 1 |");
    expect(markdown).toContain("| sys-a | 2 |");
    expect(markdown).toContain("| sys-b | 1 |");
    expect(markdown).toContain("| logging | 3 |");
    expect(markdown).toContain("| c2pa | 1 |");
  });

  it("carries the evidence-framing note and the PRD §9 block verbatim", () => {
    appendText("framed");
    const { markdown } = store.buildAuditReport();
    expect(markdown).toContain("## What this evidence is — and is not");
    expect(markdown).toContain("it is not, by itself, a determination of compliance");
    // §9 verbatim anchors (never paraphrased).
    expect(markdown).toContain("> **What this does NOT do**");
    expect(markdown).toContain(
      "> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.",
    );
    expect(markdown).toContain(
      "> - It is not legal advice. Consult qualified counsel about your obligations.",
    );
  });

  it("filters apply to the report; the header names the filter; integrity stays whole-store", () => {
    appendText("a", { systemId: "sys-a" });
    appendText("b", { systemId: "sys-b" });
    appendImage(Buffer.from("img"), "urn:c2pa:label-2");

    const report = store.buildAuditReport({ filter: { systemId: "sys-a", modality: "text" } });
    expect(report.records).toBe(1);
    expect(report.markdown).toContain("system_id = `sys-a`");
    expect(report.markdown).toContain("modality = `text`");
    // verifyChain always covers the entire store, not the filtered subset.
    expect(report.integrity).toEqual({ ok: true, checked: 3 });
    expect(report.markdown).toContain("**Chain verified** — 3 record(s) checked");
  });

  it("writes the Markdown to a file when path is given", () => {
    appendText("to-file");
    const path = join(dir, "report.md");
    const report = store.buildAuditReport({ path });
    expect(report.path).toBe(path);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(report.markdown);
  });

  it("an empty store still yields a complete report (integrity, summary, §9)", () => {
    const report = store.buildAuditReport();
    expect(report.records).toBe(0);
    expect(report.markdown).toContain("**Chain verified** — 0 record(s) checked");
    expect(report.markdown).toContain("_No records match the filter._");
    expect(report.markdown).toContain("> **What this does NOT do**");
  });
});

describe("interleaved text + image records in both exports", () => {
  it("CSV and report carry correct modality and manifest_ref for both", async () => {
    const text = appendText("interleaved text output");
    const image = appendImage(Buffer.from("signed image bytes"), "urn:c2pa:interleaved");
    appendText("second text");

    const { header, rows } = await readCsv();
    const idx = (name: string): number => header.indexOf(name);
    const imageRow = rows.find((r) => r[idx("id")] === image.id) as string[];
    const textRow = rows.find((r) => r[idx("id")] === text.id) as string[];
    expect(imageRow[idx("modality")]).toBe("image");
    expect(imageRow[idx("manifest_ref")]).toBe("urn:c2pa:interleaved");
    expect(imageRow[idx("marking_methods")]).toBe('["c2pa"]');
    expect(imageRow[idx("output_hash_normalized")]).toBe("");
    expect(textRow[idx("modality")]).toBe("text");
    expect(textRow[idx("manifest_ref")]).toBe("");

    const { markdown } = store.buildAuditReport();
    expect(markdown).toContain(`\`${image.output_hash}\``);
    expect(markdown).toContain("`urn:c2pa:interleaved`");
    expect(markdown).toContain(`\`${text.output_hash}\``);
  });
});

describe("privacy canary — exports (PRD C4). Never delete, skip, or weaken this test.", () => {
  it("raw sentinel bytes from the text and media paths appear in neither CSV nor report", async () => {
    const textSentinel = `CANARY-EXPORT-TEXT-${"cafedeadbeef"}-do-not-emit`;
    const mediaSentinel = `CANARY-EXPORT-MEDIA-${"feedfacecafe"}-do-not-emit`;

    const textRecord = appendText(`Some generated answer containing ${textSentinel} inside.`);
    const imageRecord = appendImage(
      Buffer.from(`fake image payload ${mediaSentinel} trailing bytes`),
      "urn:c2pa:canary",
    );

    const csvPath = join(dir, "canary.csv");
    const reportPath = join(dir, "canary-report.md");
    await store.exportCsv(csvPath);
    store.buildAuditReport({ path: reportPath });

    for (const path of [csvPath, reportPath]) {
      const bytes = readFileSync(path);
      // Positive control: the export really covers these records…
      expect(bytes.includes(textRecord.output_hash, 0, "utf8")).toBe(true);
      expect(bytes.includes(imageRecord.output_hash, 0, "utf8")).toBe(true);
      // …but no raw content leaves the store through any export path.
      expect(bytes.includes(textSentinel, 0, "utf8")).toBe(false);
      expect(bytes.includes(mediaSentinel, 0, "utf8")).toBe(false);
    }
  });
});
