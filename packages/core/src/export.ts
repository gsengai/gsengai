// SPDX-License-Identifier: Apache-2.0
// Audit export helpers (PRD C3): CSV serialization and the human-readable
// Markdown audit report. Both emit hashes and metadata only — the store's
// privacy posture (PRD C4) extends to every export path, canary-enforced.
import type { ChainVerification, EvidenceRecord, ExportFilter } from "./types";

/** Fixed CSV column order — matches the §4 record schema exactly. */
export const CSV_COLUMNS = [
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
] as const;

/** RFC 4180 field escaping: quote when the value contains `"`, `,`, or line breaks. */
function csvField(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function recordToCsvRow(record: EvidenceRecord): string {
  return CSV_COLUMNS.map((column) =>
    csvField(
      column === "marking_methods" ? JSON.stringify(record.marking_methods) : record[column],
    ),
  ).join(",");
}

/**
 * Canonical limits & disclaimer block, verbatim from PRD §9. Never paraphrase,
 * never improvise legal language.
 */
export const PRD_S9_LIMITS = `> **What this does NOT do**
>
> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.
> - It does not embed imperceptible watermarks (MVP). It implements the signed-metadata and logging/fingerprinting layers of a multi-layer marking strategy.
> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.
> - It does not detect third-party AI content.
> - It is not legal advice. Consult qualified counsel about your obligations.`;

/** Everything the report renderer needs; assembled by the store. */
export interface AuditReportContext {
  /** Records after the filter, in chain (seq) order. */
  records: EvidenceRecord[];
  /** Whole-store verification result — reported even (especially) when broken. */
  integrity: ChainVerification;
  storePath: string;
  /** Normalized filter actually applied, or undefined for the full store. */
  filter: ExportFilter | undefined;
  /** ISO 8601 UTC generation timestamp. */
  generatedAt: string;
}

/** Markdown table cell: pipes and line breaks would break the table structure. */
function cell(value: string | null): string {
  if (value === null || value === "") {
    return "";
  }
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ");
}

function code(value: string | null): string {
  return value === null || value === "" ? "" : `\`${cell(value)}\``;
}

function describeFilter(filter: ExportFilter | undefined): string {
  const parts: string[] = [];
  if (filter?.systemId !== undefined) {
    parts.push(`system_id = \`${cell(filter.systemId)}\``);
  }
  if (filter?.modality !== undefined) {
    parts.push(`modality = \`${filter.modality}\``);
  }
  if (filter?.since !== undefined) {
    parts.push(`ts ≥ \`${filter.since}\``);
  }
  if (filter?.until !== undefined) {
    parts.push(`ts ≤ \`${filter.until}\``);
  }
  return parts.length === 0 ? "none (full store)" : parts.join(" · ");
}

/** Count records per label, rendered most-frequent first (ties: label order). */
function breakdown(records: EvidenceRecord[], label: (r: EvidenceRecord) => string): string {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = label(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return rows.map(([key, n]) => `| ${cell(key)} | ${n} |`).join("\n");
}

function integritySection(integrity: ChainVerification): string {
  if (integrity.ok) {
    return (
      `**Chain verified** — ${integrity.checked} record(s) checked; ` +
      "the tamper-evident hash chain is intact."
    );
  }
  return (
    `**⚠ BROKEN at seq ${integrity.brokenAtSeq}** — tamper-evident hash-chain verification ` +
    `FAILED at record seq ${integrity.brokenAtSeq} (${integrity.checked} record(s) checked up ` +
    "to and including the break). Records at and after this point cannot be trusted as " +
    "appended; investigate the store before relying on this log."
  );
}

/**
 * Render the audit report (PRD C3) — the document a team hands its counsel or
 * a supervisory authority. It records what a system generated, marked, and
 * disclosed; it does not itself determine compliance (PRD §9). Integrity is
 * always reported, never suppressed: a broken chain renders prominently.
 */
export function renderAuditReport(ctx: AuditReportContext): string {
  const { records, integrity } = ctx;
  const firstTs = records[0]?.ts ?? null;
  const lastTs = records.at(-1)?.ts ?? null;

  const recordRows =
    records.length === 0
      ? "_No records match the filter._"
      : [
          "| id | ts | modality | model | system_id | output_hash | output_hash_normalized | marking_methods | manifest_ref | disclosure_context |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          ...records.map(
            (r) =>
              `| ${code(r.id)} | ${r.ts} | ${r.modality} | ${cell(r.model)} | ${cell(r.system_id)} | ` +
              `${code(r.output_hash)} | ${code(r.output_hash_normalized)} | ` +
              `${cell(r.marking_methods.join(" + "))} | ${code(r.manifest_ref)} | ${cell(r.disclosure_context)} |`,
          ),
        ].join("\n");

  const summaryBreakdowns =
    records.length === 0
      ? ""
      : `
### By modality

| Modality | Records |
| --- | --- |
${breakdown(records, (r) => r.modality)}

### By model

| Model | Records |
| --- | --- |
${breakdown(records, (r) => r.model)}

### By system_id

| system_id | Records |
| --- | --- |
${breakdown(records, (r) => r.system_id)}

### By marking methods

| Marking methods | Records |
| --- | --- |
${breakdown(records, (r) => r.marking_methods.join(" + "))}
`;

  return `# Evidence audit report (gsengai)

- Generated: ${ctx.generatedAt} (UTC)
- Store: \`${cell(ctx.storePath)}\`
- Filter: ${describeFilter(ctx.filter)}
- Record schema: v1 (PRD §4) — hashes and metadata only; raw content is never stored or exported

## Integrity

${integritySection(integrity)}

Chain verification always covers the entire store, regardless of the export filter above.

## Summary

- Records (after filter): ${records.length}
- First record: ${firstTs ?? "—"}
- Last record: ${lastTs ?? "—"}
${summaryBreakdowns}
## Records

${recordRows}

## What this evidence is — and is not

This report is a machine-generated record of the outputs an AI system generated, marked,
and disclosed, as captured in an append-only, hash-chained evidence store. It contains
cryptographic hashes and metadata only — raw prompts and outputs are never stored and
never exported. It supports compliance with EU AI Act Article 50 and California SB 942;
it is not, by itself, a determination of compliance.

${PRD_S9_LIMITS}
`;
}
