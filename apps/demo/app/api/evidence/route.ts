// SPDX-License-Identifier: Apache-2.0
// Text-flow route (ADR-0029): accepts *hashes only* — the browser computes them
// with Web Crypto and the raw text never transits. Any payload that smells like
// raw content is rejected outright. The record is appended to a request-scoped
// in-memory store (seeded, then wiped) via the real @gsengai/core.
import type { ChainVerification, EvidenceRecord } from "@gsengai/core";
import { BRAND } from "../../../lib/brand";
import { withEphemeralStore } from "../../../lib/ephemeral-store";

export const runtime = "nodejs";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The only keys a text-flow payload may carry — everything else is rejected. */
const ALLOWED_KEYS = new Set(["outputHash", "outputHashNormalized", "hashVersion"]);

export interface TextEvidenceResponse {
  record: EvidenceRecord;
  chain: ChainVerification;
}

function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Body must be JSON.");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return badRequest("Body must be a JSON object.");
  }
  const body = payload as Record<string, unknown>;

  // Privacy gate: this endpoint never accepts raw content. Unknown keys
  // (e.g. `text`, `output`, `prompt`) fail the request instead of being ignored.
  const unknown = Object.keys(body).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length > 0) {
    return badRequest(
      `Unexpected field(s): ${unknown.join(", ")}. This endpoint accepts hashes only — ` +
        "raw text is hashed in your browser and never sent.",
    );
  }

  const { outputHash, outputHashNormalized, hashVersion } = body;
  if (typeof outputHash !== "string" || !SHA256_HEX.test(outputHash)) {
    return badRequest("outputHash must be a lowercase SHA-256 hex digest (64 chars).");
  }
  if (typeof outputHashNormalized !== "string" || !SHA256_HEX.test(outputHashNormalized)) {
    return badRequest("outputHashNormalized must be a lowercase SHA-256 hex digest (64 chars).");
  }
  if (hashVersion !== 1) {
    return badRequest("hashVersion must be 1 (text normalization spec §5 v1).");
  }

  const result = await withEphemeralStore<TextEvidenceResponse>((store) => {
    const record = store.append({
      modality: "text",
      model: "example-model",
      systemId: `${BRAND}-demo/text-flow`,
      outputHashes: { outputHash, outputHashNormalized, hashVersion },
      markingMethods: ["logging"],
      disclosureContext: "demo text flow — hashed client-side, hashes-only evidence",
    });
    return { record, chain: store.verifyChain() };
  });

  return Response.json(result);
}
