// SPDX-License-Identifier: Apache-2.0
import type { AppendEvidenceInput, EvidenceRecord, EvidenceStore, FailMode } from "./types";

let lostRecordCount = 0;

/** Process-wide count of evidence records lost to fail-open evidence failures (PRD A3). */
export function getLostRecordCount(): number {
  return lostRecordCount;
}

/** Reset the lost-record counter (intended for tests and metrics scrapers that reset on read). */
export function resetLostRecordCount(): void {
  lostRecordCount = 0;
}

/**
 * Append an evidence record honoring wrapper failure semantics (PRD A3).
 *
 * `open` (default): never throws. Any failure — building the input or persisting it —
 * logs loudly, increments the process-wide lost-record counter, and returns null so the
 * model response still reaches the caller. `strict`: rethrows.
 *
 * `input` may be a factory so that input construction (e.g. prompt hashing) is also
 * covered by these semantics.
 */
export function safeAppend(
  store: EvidenceStore,
  input: AppendEvidenceInput | (() => AppendEvidenceInput),
  failMode: FailMode = "open",
): EvidenceRecord | null {
  try {
    return store.append(typeof input === "function" ? input() : input);
  } catch (err) {
    if (failMode === "strict") {
      throw err;
    }
    lostRecordCount += 1;
    console.warn(
      `[gsengai] Evidence record LOST (fail-open): appending to the evidence store failed; ` +
        `the model response was still returned. Lost records in this process so far: ${lostRecordCount}. ` +
        `Opt in to failMode: 'strict' to surface these failures as errors.`,
      err,
    );
    return null;
  }
}
