// SPDX-License-Identifier: Apache-2.0
// Image-flow route: uploads are signed in memory with the real @gsengai/c2pa
// (dev certs), the manifest declares AI generation, pre-existing manifests are
// chained as ingredients, and non-images / oversized uploads are refused.

import { TRAINED_ALGORITHMIC_MEDIA } from "@gsengai/c2pa";
import { describe, expect, it } from "vitest";
// Backend-routed asset reading so this suite runs wherever @gsengai/c2pa does —
// native c2pa-node or the c2patool fallback (issue #1).
import { resolveBackend } from "../../../packages/c2pa/src/backend";
import type { ImageMime } from "../../../packages/c2pa/src/mime";
import { makeJpeg, makePng } from "../../../packages/c2pa/test/fixtures";
import { MAX_UPLOAD_BYTES, POST, type SignImageResponse } from "../app/api/sign/route";

function post(file: File | undefined): Promise<Response> {
  const form = new FormData();
  if (file) {
    form.set("image", file);
  }
  return POST(new Request("http://demo.local/api/sign", { method: "POST", body: form }));
}

async function signOk(bytes: Uint8Array, name: string, type: string): Promise<SignImageResponse> {
  const response = await post(new File([new Uint8Array(bytes)], name, { type }));
  expect(response.status).toBe(200);
  return (await response.json()) as SignImageResponse;
}

interface ActionShape {
  action: string;
  digitalSourceType?: string;
}

async function createdAction(signedBase64: string, mimeType: string) {
  const buffer = Buffer.from(signedBase64, "base64");
  const backend = await resolveBackend();
  const store = await backend.peekStore(buffer, mimeType as ImageMime);
  const active = store?.active_manifest ? store.manifests?.[store.active_manifest] : null;
  const assertions = active?.assertions ?? [];
  return assertions
    .filter((a) => a.label.startsWith("c2pa.actions"))
    .flatMap((a) => (a.data as { actions: ActionShape[] }).actions)
    .find((a) => a.action === "c2pa.created");
}

describe("POST /api/sign (image flow)", () => {
  it("signs a PNG: created + trainedAlgorithmicMedia, untrusted dev cert reported, record written", async () => {
    const result = await signOk(makePng(), "sample.png", "image/png");

    const created = await createdAction(result.signedImage, result.mimeType);
    expect(created?.digitalSourceType).toBe(TRAINED_ALGORITHMIC_MEDIA);

    // Dev-cert honesty: valid signature, untrusted credential — reported as-is.
    expect(result.manifest.validationStatusCodes.failure).toContain("signingCredential.untrusted");
    expect(result.manifest.activeLabel).toBe(result.record.manifest_ref);

    expect(result.record.modality).toBe("image");
    expect(result.record.system_id).toBe("gsengai-demo/image-flow");
    expect(result.record.marking_methods).toEqual(["c2pa"]);
    expect(result.record.output_hash_normalized).toBeNull();
    expect(result.chain).toEqual({ ok: true, checked: 3 });
    expect(result.filename).toBe("signed-sample.png");
  });

  it("signs a JPEG the same way", async () => {
    const result = await signOk(makeJpeg(), "photo.jpg", "image/jpeg");
    const created = await createdAction(result.signedImage, result.mimeType);
    expect(created?.digitalSourceType).toBe(TRAINED_ALGORITHMIC_MEDIA);
    expect(result.manifest.validationStatusCodes.failure).toContain("signingCredential.untrusted");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.chain.ok).toBe(true);
  });

  it("chains a pre-existing manifest as an ingredient — never overwrites it", async () => {
    const first = await signOk(makePng(), "first.png", "image/png");
    const resigned = await signOk(
      new Uint8Array(Buffer.from(first.signedImage, "base64")),
      "first-signed.png",
      "image/png",
    );
    expect(resigned.manifest.ingredientCount).toBeGreaterThanOrEqual(1);
    expect(resigned.manifest.manifestLabels).toContain(first.manifest.activeLabel);
    expect(resigned.manifest.manifestLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses non-images (415), missing files (400), and oversized uploads (413)", async () => {
    expect((await post(new File([new TextEncoder().encode("plain text")], "x.txt"))).status).toBe(
      415,
    );
    expect((await post(undefined)).status).toBe(400);
    const oversized = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.png", {
      type: "image/png",
    });
    expect((await post(oversized)).status).toBe(413);
  });
});
