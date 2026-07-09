// SPDX-License-Identifier: Apache-2.0

/** Output modality of a generation: `text`, `image`, `audio`, or `video`. */
export type Modality = "text" | "image" | "audio" | "video";

/**
 * Evidence record schema v1 (PRD §4). Field names are snake_case because this is
 * the persisted, exported, hash-covered wire format — not an internal API shape.
 * `record_hash` is the SHA-256 of the canonical JSON of all other fields;
 * `prev_hash` chains it to the previous record (null for the genesis record).
 */
export interface EvidenceRecord {
  id: string;
  ts: string;
  modality: Modality;
  model: string;
  system_id: string;
  prompt_hash: string | null;
  output_hash: string;
  output_hash_normalized: string | null;
  hash_version: number;
  marking_methods: string[];
  manifest_ref: string | null;
  disclosure_context: string | null;
  prev_hash: string | null;
  record_hash: string;
}

/** Precomputed output hashes, as produced by `hashText` (PRD §5). */
export interface OutputHashes {
  outputHash: string;
  outputHashNormalized?: string | null;
  hashVersion?: number;
}

/**
 * Input for `EvidenceStore.append`. Provide exactly one of: the raw output text
 * (text modality), the raw output bytes (media modalities — e.g. the signed image
 * file), or precomputed hashes. Text and bytes are hashed in memory and never
 * persisted (PRD C4).
 */
export type AppendEvidenceInput = {
  modality: Modality;
  model: string;
  systemId: string;
  promptHash?: string | null;
  disclosureContext?: string | null;
  /** Reference to the C2PA manifest (active manifest label) for signed media (PRD B6). */
  manifestRef?: string | null;
  /** Defaults to `['logging']`. */
  markingMethods?: string[];
} & (
  | { outputText: string; outputBytes?: never; outputHashes?: never }
  | { outputText?: never; outputBytes: Uint8Array; outputHashes?: never }
  | { outputText?: never; outputBytes?: never; outputHashes: OutputHashes }
);

/**
 * Optional filter for audit exports (CSV and report — PRD C3). All conditions
 * are ANDed; an empty/omitted filter exports the full store. `since`/`until`
 * are instants (any `Date.parse`-able string, normalized to ISO 8601 UTC),
 * compared inclusively against each record's `ts`.
 */
export interface ExportFilter {
  systemId?: string;
  modality?: Modality;
  since?: string;
  until?: string;
}

/** Options for `EvidenceStore.buildAuditReport`. */
export interface AuditReportOptions {
  /** When set, the Markdown is also written to this file. */
  path?: string;
  filter?: ExportFilter;
}

/** Result of `EvidenceStore.buildAuditReport`. */
export interface AuditReport {
  markdown: string;
  /** Number of records listed in the report (after the filter). */
  records: number;
  /** Whole-store chain verification — always surfaced, never suppressed. */
  integrity: ChainVerification;
  path: string | null;
}

/** Result of `EvidenceStore.verifyChain()`. */
export interface ChainVerification {
  ok: boolean;
  /** Number of records examined (on failure: including the broken one). */
  checked: number;
  /** `seq` of the first record whose hash or chain linkage does not verify. */
  brokenAtSeq?: number;
}

export interface EvidenceStore {
  /** Append one evidence record. Hashes are computed in memory; raw text never touches disk. */
  append(input: AppendEvidenceInput): EvidenceRecord;
  /** Exact lookup on the raw output hash. */
  findByOutputHash(hash: string): EvidenceRecord[];
  /**
   * Detection primitive (PRD A5): hashes `text` and matches on the exact hash and on
   * the normalized hash (spec §5 v1 — the only version so far; lookups apply the
   * algorithm recorded, never silently the latest).
   */
  findByText(text: string): EvidenceRecord[];
  /** Stream all records, in chain order, to a JSONL file (one canonical-JSON record per line). */
  exportJsonl(path: string): Promise<{ records: number; path: string }>;
  /**
   * Stream records, in chain order, to a CSV file (PRD C3). Header row; fixed
   * column order matching the §4 schema. Hashes and metadata only — no export
   * path emits raw content.
   */
  exportCsv(path: string, filter?: ExportFilter): Promise<{ records: number; path: string }>;
  /**
   * Build the human-readable audit report (Markdown — PRD C3). The report
   * always renders; the `verifyChain()` outcome is surfaced in its Integrity
   * section (verified or BROKEN), never suppressed and never thrown on.
   */
  buildAuditReport(opts?: AuditReportOptions): AuditReport;
  /** Validate the full tamper-evident hash chain and report the first break. */
  verifyChain(): ChainVerification;
  count(): number;
  close(): void;
}

export interface CreateEvidenceStoreOptions {
  /** SQLite database file path (`:memory:` is supported for ephemeral stores). */
  path: string;
  /**
   * NOT IMPLEMENTED in the MVP — throws `NotImplementedError` when set (PRD C4).
   * The privacy default is hashes and metadata only; encrypted raw capture is P1.
   */
  storeRawContent?: boolean;
}

/** Failure semantics for wrappers (PRD A3). */
export type FailMode = "open" | "strict";

/** Shared options for all SDK wrapper packages. */
export interface EvidenceWrapperOptions {
  store: EvidenceStore;
  /** Integrator's system/feature identifier — persisted as `system_id` (required, PRD §4). */
  systemId: string;
  /** Hash the request messages/input into `prompt_hash`. Default: true. */
  capturePromptHash?: boolean;
  /**
   * `open` (default): an evidence-store failure logs loudly and increments the
   * lost-record counter, but the model response is still returned.
   * `strict`: the failure is thrown to the caller.
   */
  failMode?: FailMode;
}
