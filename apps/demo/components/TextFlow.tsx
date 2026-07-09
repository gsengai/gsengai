// SPDX-License-Identifier: Apache-2.0
"use client";
// Text flow (ADR-0029): the pasted text is hashed here, in the browser, with
// Web Crypto — only the hashes are POSTed. The server appends them to an
// ephemeral store via the real @gsengai/core and returns the §4 record.
import type { ChainVerification, EvidenceRecord } from "@gsengai/core";
import { useId, useState } from "react";
import { hashTextClient } from "../lib/client-hash";
import { PRIVACY_TEXT_FLOW } from "../lib/copy";
import { ChainBadge, EvidenceRecordView } from "./EvidenceRecordView";

interface TextResult {
  record: EvidenceRecord;
  chain: ChainVerification;
}

export function TextFlow() {
  const inputId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TextResult | null>(null);

  async function generateEvidence() {
    setBusy(true);
    setError(null);
    try {
      const hashes = await hashTextClient(text);
      const response = await fetch("/api/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hashes),
      });
      const body = (await response.json()) as TextResult & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }
      setResult(body);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function recordJsonHref(record: EvidenceRecord): string {
    return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(record, null, 2))}`;
  }

  return (
    <section className="card" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>Text — hash-only evidence record</h2>
      <p className="card-sub">Paste any text and treat it as a model output. {PRIVACY_TEXT_FLOW}</p>
      <label className="field-label" htmlFor={inputId}>
        Text to fingerprint (never leaves your browser)
      </label>
      <textarea
        id={inputId}
        className="text-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste a model output here…"
      />
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={generateEvidence}
          disabled={busy || text.length === 0}
        >
          {busy ? "Hashing…" : "Generate evidence"}
        </button>
        <span className="hint">SHA-256, raw + normalized (spec §5)</span>
      </div>
      {error !== null && <p className="error-note">{error}</p>}
      {result !== null && (
        <div className="result" aria-live="polite">
          <ChainBadge chain={result.chain} />
          <EvidenceRecordView record={result.record} />
          <a
            className="download"
            href={recordJsonHref(result.record)}
            download={`evidence-${result.record.id}.json`}
          >
            Download record as JSON
          </a>
        </div>
      )}
    </section>
  );
}
