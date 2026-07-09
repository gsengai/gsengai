// SPDX-License-Identifier: Apache-2.0
"use client";
import type { ManifestSummary } from "@gsengai/c2pa";
// Image flow: upload a PNG/JPEG, the server signs it with the real @gsengai/c2pa
// (dev certificates) and returns the signed bytes plus a readManifest summary.
// The dev-cert caveat (ADR-0030) is rendered statically in this same view,
// before and next to the verify link — the "untrusted issuer" verdict on
// contentcredentials.org is expected, not a broken demo.
import type { ChainVerification, EvidenceRecord } from "@gsengai/core";
import { useId, useState } from "react";
import { DEV_CERT_CAVEAT, PRIVACY_IMAGE_FLOW, VERIFY_URL } from "../lib/copy";
import { ChainBadge, EvidenceRecordView } from "./EvidenceRecordView";

interface SignResult {
  record: EvidenceRecord;
  chain: ChainVerification;
  manifest: ManifestSummary;
  signedImage: string;
  mimeType: string;
  filename: string;
}

export function ImageFlow() {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignResult | null>(null);

  async function signImage() {
    if (file === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("image", file);
      const response = await fetch("/api/sign", { method: "POST", body: form });
      const body = (await response.json()) as SignResult & { error?: string };
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

  return (
    <section className="card" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>Image — C2PA-signed provenance</h2>
      <p className="card-sub">
        Upload a PNG or JPEG and treat it as a model output. {PRIVACY_IMAGE_FLOW}
      </p>
      <label className="field-label" htmlFor={inputId}>
        Image to sign (PNG or JPEG, up to 8 MiB)
      </label>
      <input
        id={inputId}
        className="file-input"
        type="file"
        accept="image/png,image/jpeg"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={signImage}
          disabled={busy || file === null}
        >
          {busy ? "Signing…" : "Sign with C2PA"}
        </button>
        <span className="hint">Signed in memory — never stored</span>
      </div>
      <p className="caveat">
        <strong>Development certificates</strong>
        {DEV_CERT_CAVEAT}
      </p>
      {error !== null && <p className="error-note">{error}</p>}
      {result !== null && (
        <div className="result" aria-live="polite">
          <ChainBadge chain={result.chain} />
          <ul className="manifest-list">
            <li>
              Active manifest: <code>{result.manifest.activeLabel}</code>
            </li>
            <li>
              Validation state: <code>{result.manifest.validationState ?? "unknown"}</code>{" "}
              {result.manifest.validationStatusCodes.failure.length > 0 && (
                <>
                  — codes: <code>{result.manifest.validationStatusCodes.failure.join(", ")}</code>{" "}
                  (the expected dev-cert outcome)
                </>
              )}
            </li>
            <li>
              Ingredients: {result.manifest.ingredientCount}
              {result.manifest.ingredientCount > 0 &&
                " — the uploaded image already carried a manifest; it was chained, never overwritten"}
            </li>
            <li>
              Declares <code>digitalSourceType: trainedAlgorithmicMedia</code> via a{" "}
              <code>c2pa.actions</code> created action
            </li>
          </ul>
          <p style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <a
              className="download"
              href={`data:${result.mimeType};base64,${result.signedImage}`}
              download={result.filename}
            >
              Download signed image
            </a>
            <a className="verify-link" href={VERIFY_URL} target="_blank" rel="noreferrer">
              Verify on contentcredentials.org ↗
            </a>
          </p>
          <EvidenceRecordView record={result.record} />
        </div>
      )}
    </section>
  );
}
