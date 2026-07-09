// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { canonicalJson } from "./canonical-json";
import { NotImplementedError } from "./errors";
import { CSV_COLUMNS, recordToCsvRow, renderAuditReport } from "./export";
import { HASH_VERSION, hashText, sha256Hex } from "./hash";
import type {
  AppendEvidenceInput,
  AuditReport,
  AuditReportOptions,
  ChainVerification,
  CreateEvidenceStoreOptions,
  EvidenceRecord,
  EvidenceStore,
  ExportFilter,
  Modality,
} from "./types";

const MODALITIES: ReadonlySet<string> = new Set(["text", "image", "audio", "video"]);

// Append-only law (PRD C1): no UPDATE/DELETE path exists in this API, and the
// triggers below abort raw SQL attempts as defense in depth. Never remove them.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS evidence (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  ts TEXT NOT NULL,
  modality TEXT NOT NULL CHECK (modality IN ('text','image','audio','video')),
  model TEXT NOT NULL,
  system_id TEXT NOT NULL,
  prompt_hash TEXT,
  output_hash TEXT NOT NULL,
  output_hash_normalized TEXT,
  hash_version INTEGER NOT NULL,
  marking_methods TEXT NOT NULL,
  manifest_ref TEXT,
  disclosure_context TEXT,
  prev_hash TEXT,
  record_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_output_hash
  ON evidence (output_hash);
CREATE INDEX IF NOT EXISTS idx_evidence_output_hash_normalized
  ON evidence (output_hash_normalized);
CREATE TRIGGER IF NOT EXISTS evidence_append_only_update
BEFORE UPDATE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'gsengai evidence store is append-only: UPDATE is not permitted');
END;
CREATE TRIGGER IF NOT EXISTS evidence_append_only_delete
BEFORE DELETE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'gsengai evidence store is append-only: DELETE is not permitted');
END;
`;

interface EvidenceRow {
  seq: number;
  id: string;
  ts: string;
  modality: string;
  model: string;
  system_id: string;
  prompt_hash: string | null;
  output_hash: string;
  output_hash_normalized: string | null;
  hash_version: number;
  marking_methods: string;
  manifest_ref: string | null;
  disclosure_context: string | null;
  prev_hash: string | null;
  record_hash: string;
}

function rowToRecord(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    ts: row.ts,
    modality: row.modality as Modality,
    model: row.model,
    system_id: row.system_id,
    prompt_hash: row.prompt_hash,
    output_hash: row.output_hash,
    output_hash_normalized: row.output_hash_normalized,
    hash_version: row.hash_version,
    marking_methods: JSON.parse(row.marking_methods) as string[],
    manifest_ref: row.manifest_ref,
    disclosure_context: row.disclosure_context,
    prev_hash: row.prev_hash,
    record_hash: row.record_hash,
  };
}

/** `record_hash = sha256(canonicalJson(all fields above))` per PRD §4. */
function computeRecordHash(body: Omit<EvidenceRecord, "record_hash">): string {
  return sha256Hex(canonicalJson(body));
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`gsengai: ${name} must be a non-empty string`);
  }
  return value;
}

function resolveOutputHashes(input: AppendEvidenceInput): {
  output_hash: string;
  output_hash_normalized: string | null;
  hash_version: number;
} {
  const provided = [input.outputText, input.outputBytes, input.outputHashes].filter(
    (v) => v !== undefined,
  );
  if (provided.length !== 1) {
    throw new TypeError("gsengai: provide exactly one of outputText, outputBytes, or outputHashes");
  }
  if (input.outputText !== undefined) {
    // Raw text is hashed here, in memory, and goes no further (PRD C4).
    const hashes = hashText(input.outputText);
    return {
      output_hash: hashes.outputHash,
      output_hash_normalized: hashes.outputHashNormalized,
      hash_version: hashes.hashVersion,
    };
  }
  if (input.outputBytes !== undefined) {
    // Raw bytes (e.g. the signed image file) are hashed here, in memory, and go
    // no further (PRD C4). Text normalization does not apply (ADR-0018).
    return {
      output_hash: sha256Hex(input.outputBytes),
      output_hash_normalized: null,
      hash_version: HASH_VERSION,
    };
  }
  const given = input.outputHashes as NonNullable<typeof input.outputHashes>;
  return {
    output_hash: requireNonEmptyString(given.outputHash, "outputHashes.outputHash"),
    output_hash_normalized: given.outputHashNormalized ?? null,
    hash_version: given.hashVersion ?? HASH_VERSION,
  };
}

function normalizeInstant(value: string, name: string): string {
  const ms = Date.parse(requireNonEmptyString(value, name));
  if (Number.isNaN(ms)) {
    throw new TypeError(`gsengai: ${name} must be a Date.parse-able timestamp`);
  }
  return new Date(ms).toISOString();
}

/**
 * Translate an ExportFilter into a WHERE clause (PRD C3). `since`/`until` are
 * normalized to ISO 8601 UTC, so lexicographic comparison against the stored
 * `ts` (always `toISOString()` output) is a correct instant comparison; both
 * bounds are inclusive.
 */
function buildFilter(filter: ExportFilter | undefined): {
  where: string;
  params: Record<string, string>;
  normalized: ExportFilter | undefined;
} {
  if (filter === undefined) {
    return { where: "", params: {}, normalized: undefined };
  }
  const conditions: string[] = [];
  const params: Record<string, string> = {};
  const normalized: ExportFilter = {};
  if (filter.systemId !== undefined) {
    normalized.systemId = requireNonEmptyString(filter.systemId, "filter.systemId");
    conditions.push("system_id = @systemId");
    params.systemId = normalized.systemId;
  }
  if (filter.modality !== undefined) {
    if (!MODALITIES.has(filter.modality)) {
      throw new TypeError(
        "gsengai: filter.modality must be one of 'text' | 'image' | 'audio' | 'video'",
      );
    }
    normalized.modality = filter.modality;
    conditions.push("modality = @modality");
    params.modality = normalized.modality;
  }
  if (filter.since !== undefined) {
    normalized.since = normalizeInstant(filter.since, "filter.since");
    conditions.push("ts >= @since");
    params.since = normalized.since;
  }
  if (filter.until !== undefined) {
    normalized.until = normalizeInstant(filter.until, "filter.until");
    conditions.push("ts <= @until");
    params.until = normalized.until;
  }
  if (conditions.length === 0) {
    return { where: "", params: {}, normalized: undefined };
  }
  return { where: ` WHERE ${conditions.join(" AND ")}`, params, normalized };
}

export function createEvidenceStore(options: CreateEvidenceStoreOptions): EvidenceStore {
  if (options.storeRawContent) {
    throw new NotImplementedError(
      "gsengai: storeRawContent is not implemented in the MVP. Only hashes and metadata persist " +
        "(PRD C4); encrypted raw-content capture is planned post-MVP.",
    );
  }
  const storePath = requireNonEmptyString(options.path, "path");
  const db = new Database(storePath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO evidence (
      id, ts, modality, model, system_id, prompt_hash, output_hash,
      output_hash_normalized, hash_version, marking_methods, manifest_ref,
      disclosure_context, prev_hash, record_hash
    ) VALUES (
      @id, @ts, @modality, @model, @system_id, @prompt_hash, @output_hash,
      @output_hash_normalized, @hash_version, @marking_methods, @manifest_ref,
      @disclosure_context, @prev_hash, @record_hash
    )
  `);
  const lastHashStmt = db.prepare("SELECT record_hash FROM evidence ORDER BY seq DESC LIMIT 1");
  const allStmt = db.prepare("SELECT * FROM evidence ORDER BY seq");
  const byOutputHashStmt = db.prepare("SELECT * FROM evidence WHERE output_hash = ? ORDER BY seq");
  const byTextStmt = db.prepare(
    "SELECT * FROM evidence WHERE output_hash = @raw OR output_hash_normalized = @normalized ORDER BY seq",
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM evidence");

  function filteredRows(filter: ExportFilter | undefined): {
    rows: IterableIterator<EvidenceRow>;
    normalized: ExportFilter | undefined;
  } {
    const { where, params, normalized } = buildFilter(filter);
    const stmt = db.prepare(`SELECT * FROM evidence${where} ORDER BY seq`);
    return { rows: stmt.iterate(params) as IterableIterator<EvidenceRow>, normalized };
  }

  function verifyChainImpl(): ChainVerification {
    let checked = 0;
    let prevHash: string | null = null;
    for (const row of allStmt.iterate() as IterableIterator<EvidenceRow>) {
      checked += 1;
      const { record_hash, ...body } = rowToRecord(row);
      if (body.prev_hash !== prevHash || computeRecordHash(body) !== record_hash) {
        return { ok: false, checked, brokenAtSeq: row.seq };
      }
      prevHash = record_hash;
    }
    return { ok: true, checked };
  }

  // Reading the chain head and inserting must be atomic so prev_hash linkage
  // stays correct under concurrent writers.
  const runAppend = db.transaction(
    (body: Omit<EvidenceRecord, "prev_hash" | "record_hash">): EvidenceRecord => {
      const last = lastHashStmt.get() as { record_hash: string } | undefined;
      const chained: Omit<EvidenceRecord, "record_hash"> = {
        ...body,
        prev_hash: last ? last.record_hash : null,
      };
      const record: EvidenceRecord = { ...chained, record_hash: computeRecordHash(chained) };
      insertStmt.run({ ...record, marking_methods: JSON.stringify(record.marking_methods) });
      return record;
    },
  );

  return {
    append(input: AppendEvidenceInput): EvidenceRecord {
      const modality = input.modality;
      if (typeof modality !== "string" || !MODALITIES.has(modality)) {
        throw new TypeError(
          "gsengai: modality must be one of 'text' | 'image' | 'audio' | 'video'",
        );
      }
      const body: Omit<EvidenceRecord, "prev_hash" | "record_hash"> = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        modality,
        model: requireNonEmptyString(input.model, "model"),
        system_id: requireNonEmptyString(input.systemId, "systemId"),
        prompt_hash: input.promptHash ?? null,
        ...resolveOutputHashes(input),
        marking_methods: input.markingMethods ?? ["logging"],
        manifest_ref: input.manifestRef ?? null,
        disclosure_context: input.disclosureContext ?? null,
      };
      return runAppend.immediate(body);
    },

    findByOutputHash(hash: string): EvidenceRecord[] {
      const rows = byOutputHashStmt.all(hash) as EvidenceRow[];
      return rows.map(rowToRecord);
    },

    findByText(text: string): EvidenceRecord[] {
      // §5: lookups apply the recorded algorithm version. v1 is the only version,
      // so the v1 normalization is applied here; a future v2 must dispatch on
      // each record's hash_version instead of silently using the latest.
      const hashes = hashText(text);
      const rows = byTextStmt.all({
        raw: hashes.outputHash,
        normalized: hashes.outputHashNormalized,
      }) as EvidenceRow[];
      return rows.map(rowToRecord);
    },

    async exportJsonl(path: string): Promise<{ records: number; path: string }> {
      const out = createWriteStream(path, { encoding: "utf8" });
      let records = 0;
      try {
        for (const row of allStmt.iterate() as IterableIterator<EvidenceRow>) {
          const line = `${canonicalJson(rowToRecord(row))}\n`;
          if (!out.write(line)) {
            await once(out, "drain");
          }
          records += 1;
        }
      } finally {
        out.end();
      }
      await once(out, "close");
      return { records, path };
    },

    async exportCsv(
      path: string,
      filter?: ExportFilter,
    ): Promise<{ records: number; path: string }> {
      const { rows } = filteredRows(filter);
      const out = createWriteStream(path, { encoding: "utf8" });
      let records = 0;
      try {
        if (!out.write(`${CSV_COLUMNS.join(",")}\n`)) {
          await once(out, "drain");
        }
        for (const row of rows) {
          const line = `${recordToCsvRow(rowToRecord(row))}\n`;
          if (!out.write(line)) {
            await once(out, "drain");
          }
          records += 1;
        }
      } finally {
        out.end();
      }
      await once(out, "close");
      return { records, path };
    },

    buildAuditReport(opts: AuditReportOptions = {}): AuditReport {
      const { rows, normalized } = filteredRows(opts.filter);
      const records = [...rows].map(rowToRecord);
      // Whole-store verification, independent of the filter: the report always
      // renders and the outcome is always surfaced (verified or BROKEN).
      const integrity = verifyChainImpl();
      const markdown = renderAuditReport({
        records,
        integrity,
        storePath,
        filter: normalized,
        generatedAt: new Date().toISOString(),
      });
      if (opts.path !== undefined) {
        writeFileSync(opts.path, markdown, "utf8");
      }
      return { markdown, records: records.length, integrity, path: opts.path ?? null };
    },

    verifyChain: verifyChainImpl,

    count(): number {
      const row = countStmt.get() as { n: number };
      return row.n;
    },

    close(): void {
      db.close();
    },
  };
}
