// SPDX-License-Identifier: Apache-2.0
// Renders a §4 evidence record and its chain-verification outcome. Shared by
// both flows; shows every schema field so the demo is honest about exactly
// what is (and is not) persisted.
import type { ChainVerification, EvidenceRecord } from "@gsengai/core";

/** §4 field order — rendered exactly as persisted. */
const FIELDS = [
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

function renderValue(record: EvidenceRecord, field: (typeof FIELDS)[number]) {
  const value = record[field];
  if (value === null) {
    return <span className="null">null</span>;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function ChainBadge({ chain }: { chain: ChainVerification }) {
  return (
    <span className={`chain-badge ${chain.ok ? "ok" : "bad"}`} role="status">
      {chain.ok
        ? `Chain verified — ${chain.checked} record${chain.checked === 1 ? "" : "s"} checked`
        : `Chain BROKEN at seq ${chain.brokenAtSeq}`}
    </span>
  );
}

export function EvidenceRecordView({ record }: { record: EvidenceRecord }) {
  return (
    <table className="record-table">
      <caption className="hint" style={{ textAlign: "left", captionSide: "bottom" }}>
        Hashes and metadata only — this is the entire record; no raw content is stored.
      </caption>
      <tbody>
        {FIELDS.map((field) => (
          <tr key={field}>
            <th scope="row">{field}</th>
            <td>{renderValue(record, field)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
