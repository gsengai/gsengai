// SPDX-License-Identifier: Apache-2.0
// Image-flow route: signs an uploaded PNG/JPEG with the real @gsengai/c2pa signer
// (bundled DEV certificates — untrusted by public validators, stated in the UI).
// Bytes are processed in memory only (buffer in, buffer out) and never
// persisted (ADR-0029); the evidence record goes to a request-scoped in-memory
// store that is wiped before the response leaves.

import {
  createImageSigner,
  detectImageMime,
  type ManifestSummary,
  readManifest,
} from "@gsengai/c2pa";
import type { ChainVerification, EvidenceRecord } from "@gsengai/core";
import { BRAND } from "../../../lib/brand";
import { withEphemeralStore } from "../../../lib/ephemeral-store";

export const runtime = "nodejs";

/** Demo upload cap — enough for any sample image, small enough to stay snappy. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface SignImageResponse {
  record: EvidenceRecord;
  chain: ChainVerification;
  /** `readManifest` summary of the signed output (includes the untrusted-dev-cert codes). */
  manifest: ManifestSummary;
  /** Signed asset, base64-encoded for download in the browser. */
  signedImage: string;
  mimeType: string;
  filename: string;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function downloadName(uploadName: string | undefined, mimeType: string): string {
  const fallback = mimeType === "image/png" ? "image.png" : "image.jpg";
  const base = (uploadName ?? fallback).replace(/[^A-Za-z0-9._-]/gu, "_");
  return `signed-${base === "" ? fallback : base}`;
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Body must be multipart/form-data with an `image` file field.", 400);
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return errorResponse("Missing `image` file field.", 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse("Image is larger than the 8 MiB demo limit.", 413);
  }

  const inputBytes = new Uint8Array(await file.arrayBuffer());
  let mimeType: string;
  try {
    mimeType = detectImageMime(inputBytes, "uploaded file");
  } catch {
    return errorResponse("Only PNG and JPEG images are supported (MVP).", 415);
  }

  const result = await withEphemeralStore<SignImageResponse | Response>(async (store) => {
    const signer = createImageSigner({ store, systemId: `${BRAND}-demo/image-flow` });
    const signed = await signer.signImage({
      input: inputBytes,
      model: "example-image-model",
      disclosureContext: "demo image flow — dev-cert C2PA signing, bytes never persisted",
    });
    if (!(signed.output instanceof Buffer) || signed.record === null) {
      return errorResponse("Signing did not produce an in-memory result.", 500);
    }
    const manifest = await readManifest(signed.output);
    if (manifest === null) {
      return errorResponse("Signed output carries no readable manifest.", 500);
    }
    return {
      record: signed.record,
      chain: store.verifyChain(),
      manifest,
      signedImage: signed.output.toString("base64"),
      mimeType,
      filename: downloadName(file.name, mimeType),
    };
  });

  return result instanceof Response ? result : Response.json(result);
}
