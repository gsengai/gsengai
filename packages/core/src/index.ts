// SPDX-License-Identifier: Apache-2.0

export { canonicalJson, hashPrompt } from "./canonical-json";
export type { CliIo } from "./cli";
export { runAuditCli } from "./cli";
export { NotImplementedError } from "./errors";
export type { AuditReportContext } from "./export";
export { CSV_COLUMNS, PRD_S9_LIMITS, renderAuditReport } from "./export";
export { getLostRecordCount, resetLostRecordCount, safeAppend } from "./fail";
export type { TextHashes } from "./hash";
export { HASH_VERSION, hashText, normalizeText, sha256Hex } from "./hash";
export type { InstrumentHooks } from "./iterable";
export { instrumentAsyncIterable } from "./iterable";
export { createEvidenceStore } from "./store";
export type {
  AppendEvidenceInput,
  AuditReport,
  AuditReportOptions,
  ChainVerification,
  CreateEvidenceStoreOptions,
  EvidenceRecord,
  EvidenceStore,
  EvidenceWrapperOptions,
  ExportFilter,
  FailMode,
  Modality,
  OutputHashes,
} from "./types";
