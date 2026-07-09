// SPDX-License-Identifier: Apache-2.0
/**
 * gsengai audit export example — seed an evidence store, then produce the two
 * audit artifacts (PRD C3): a CSV export and a human-readable Markdown audit
 * report. Run from the repo root with `pnpm audit-export`.
 *
 * Keyless and offline: the records are seeded directly; nothing touches the
 * network. Exports carry hashes and metadata only — raw content never
 * persists and never leaves the store.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceStore } from "@gsengai/core";

const outDir = join(dirname(fileURLToPath(import.meta.url)), ".out");
mkdirSync(outDir, { recursive: true });
const dbPath = join(outDir, "audit-demo.db");
// Fresh demo store each run, so counts in the report are predictable.
rmSync(dbPath, { force: true });
for (const suffix of ["-wal", "-shm"]) {
  rmSync(dbPath + suffix, { force: true });
}

const store = createEvidenceStore({ path: dbPath });

// Seed a realistic mix: text generations from two features + one signed image.
store.append({
  modality: "text",
  model: "gpt-4o-mini",
  systemId: "support-chat",
  outputText: "Sample assistant reply one — hashed in memory, never persisted.",
});
store.append({
  modality: "text",
  model: "gpt-4o-mini",
  systemId: "support-chat",
  outputText: "Sample assistant reply two.",
});
store.append({
  modality: "text",
  model: "claude-sonnet-5",
  systemId: "marketing-copy",
  outputText: "Sample generated tagline.",
});
store.append({
  modality: "image",
  model: "gpt-image-1",
  systemId: "image-studio",
  outputBytes: Buffer.from("stand-in for signed image bytes"),
  manifestRef: "urn:c2pa:example-manifest-label",
  markingMethods: ["c2pa"],
});

const csvPath = join(outDir, "audit-export.csv");
const reportPath = join(outDir, "audit-report.md");

const csv = await store.exportCsv(csvPath);
const report = store.buildAuditReport({ path: reportPath });

console.log(`CSV export:   ${csv.records} record(s) -> ${csv.path}`);
console.log(`Audit report: ${report.records} record(s) -> ${reportPath}`);
console.log(
  report.integrity.ok
    ? `Integrity:    chain verified (${report.integrity.checked} record(s) checked)`
    : `Integrity:    BROKEN at seq ${report.integrity.brokenAtSeq} — surfaced in the report, never suppressed`,
);
console.log("\nBoth artifacts contain hashes and metadata only — no raw content.");
console.log("Render the Markdown report to PDF/HTML before handing it to counsel,");
console.log("e.g. with pandoc: pandoc examples/.out/audit-report.md -o audit-report.pdf");

store.close();
