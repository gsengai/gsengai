// SPDX-License-Identifier: Apache-2.0
// Minimal zero-dep audit CLI. Deliberately unpolished: parseArgs,
// two formats, plain output. Rich help, colour, and config files are non-goals.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createEvidenceStore } from "./store";
import type { ExportFilter, Modality } from "./types";

const USAGE = `gsengai-audit — export audit artifacts from an gsengai evidence store.
Supports compliance with EU AI Act Article 50 and California SB 942. Exports
contain hashes and metadata only; raw content is never stored or exported.
Not legal advice.

Usage:
  gsengai-audit export --store <evidence.db> --format csv|report --out <path>
                    [--system-id <id>] [--modality text|image|audio|video]
                    [--since <ISO timestamp>] [--until <ISO timestamp>]

Formats:
  csv     streaming CSV of evidence records (fixed schema-v1 column order)
  report  human-readable Markdown audit report (integrity, summary, records)

Tip: render the report Markdown to PDF/HTML yourself before handing it to
counsel (e.g. pandoc report.md -o report.pdf).`;

/** Where CLI output goes; injectable for tests. */
export interface CliIo {
  log(message: string): void;
  error(message: string): void;
}

const MODALITIES: ReadonlySet<string> = new Set(["text", "image", "audio", "video"]);

function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      store: { type: "string" },
      format: { type: "string" },
      out: { type: "string" },
      "system-id": { type: "string" },
      modality: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      help: { type: "boolean" },
    },
  } as const);
}

/**
 * The function the `gsengai-audit` bin calls. Returns the process exit code.
 * Read-only over the store: it opens, exports, and closes.
 */
export async function runAuditCli(argv: string[], io: CliIo = console): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    io.error(USAGE);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.help === true) {
    io.log(USAGE);
    return 0;
  }
  if (positionals[0] !== "export" || positionals.length !== 1) {
    io.error("gsengai-audit: the only supported command is 'export'");
    io.error(USAGE);
    return 1;
  }
  const storePath = values.store;
  const format = values.format;
  const outPath = values.out;
  if (storePath === undefined || format === undefined || outPath === undefined) {
    io.error("gsengai-audit: --store, --format, and --out are required");
    io.error(USAGE);
    return 1;
  }
  if (format !== "csv" && format !== "report") {
    io.error(`gsengai-audit: unknown --format '${format}' (expected csv or report)`);
    return 1;
  }
  // createEvidenceStore would create an empty DB at a mistyped path; refuse instead.
  if (!existsSync(storePath)) {
    io.error(`gsengai-audit: no evidence store found at '${storePath}'`);
    return 1;
  }
  const modality = values.modality;
  if (modality !== undefined && !MODALITIES.has(modality)) {
    io.error(`gsengai-audit: unknown --modality '${modality}' (expected text|image|audio|video)`);
    return 1;
  }
  const filter: ExportFilter = {};
  if (values["system-id"] !== undefined) {
    filter.systemId = values["system-id"];
  }
  if (modality !== undefined) {
    filter.modality = modality as Modality;
  }
  if (values.since !== undefined) {
    filter.since = values.since;
  }
  if (values.until !== undefined) {
    filter.until = values.until;
  }

  const store = createEvidenceStore({ path: storePath });
  try {
    if (format === "csv") {
      const result = await store.exportCsv(outPath, filter);
      io.log(`CSV export: ${result.records} record(s) -> ${result.path}`);
    } else {
      const report = store.buildAuditReport({ path: outPath, filter });
      io.log(`Audit report: ${report.records} record(s) -> ${outPath}`);
      if (report.integrity.ok) {
        io.log(`Integrity: chain verified (${report.integrity.checked} record(s) checked)`);
      } else {
        // Never suppressed: the break is in the report AND on stderr.
        io.error(
          `WARNING: evidence hash chain BROKEN at seq ${report.integrity.brokenAtSeq} — ` +
            "the Integrity section of the report records the break.",
        );
      }
    }
  } catch (err) {
    io.error(`gsengai-audit: export failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    store.close();
  }
  return 0;
}
