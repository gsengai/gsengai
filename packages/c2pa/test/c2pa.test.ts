// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createImageSigner,
  GENERATOR_ASSERTION_LABEL,
  readManifest,
  TRAINED_ALGORITHMIC_MEDIA,
} from "@gsengai/c2pa";
import {
  createEvidenceStore,
  type EvidenceStore,
  getLostRecordCount,
  resetLostRecordCount,
  sha256Hex,
} from "@gsengai/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Backend-routed asset reading so this suite runs wherever the package does —
// native c2pa-node or the c2patool fallback (issue #1).
import { type ManifestJson, resolveBackend } from "../src/backend";
import type { ImageMime } from "../src/mime";
import { makeJpeg, makePng } from "./fixtures";

interface ActionShape {
  action: string;
  digitalSourceType?: string;
  softwareAgent?: { name: string };
  when?: string;
}

async function activeManifestOf(bytes: Buffer, mimeType: ImageMime): Promise<ManifestJson | null> {
  const backend = await resolveBackend();
  const store = await backend.peekStore(bytes, mimeType);
  if (!store?.active_manifest) {
    return null;
  }
  return store.manifests?.[store.active_manifest] ?? null;
}

async function activeLabelOf(bytes: Buffer, mimeType: ImageMime): Promise<string | null> {
  const backend = await resolveBackend();
  return (await backend.peekStore(bytes, mimeType))?.active_manifest ?? null;
}

async function actionsOf(bytes: Buffer, mimeType: ImageMime): Promise<ActionShape[]> {
  const assertions = (await activeManifestOf(bytes, mimeType))?.assertions ?? [];
  return assertions
    .filter((a) => a.label.startsWith("c2pa.actions"))
    .flatMap((a) => (a.data as { actions: ActionShape[] }).actions);
}

let dir: string;
let store: EvidenceStore;
let open = false;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-c2pa-"));
  store = createEvidenceStore({ path: join(dir, "evidence.db") });
  open = true;
});

afterEach(() => {
  if (open) {
    store.close();
    open = false;
  }
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function newSigner(overrides: { store?: EvidenceStore; failMode?: "open" | "strict" } = {}) {
  return createImageSigner({
    store: overrides.store ?? store,
    systemId: "test-system",
    failMode: overrides.failMode,
  });
}

describe("signImage — PNG/JPEG signing (PRD B1/B2)", () => {
  it("signs a PNG: active manifest present, created action with trainedAlgorithmicMedia, model + timestamp recorded", async () => {
    const signer = newSigner();
    const outPath = join(dir, "signed.png");
    const result = await signer.signImage({
      input: makePng(),
      output: outPath,
      model: "test-image-model-1",
    });

    expect(result.output).toBe(outPath);
    expect(result.manifestLabel).toMatch(/^urn:c2pa:/);

    const signedBytes = readFileSync(outPath);
    expect(await activeLabelOf(signedBytes, "image/png")).toBe(result.manifestLabel);

    const actions = await actionsOf(signedBytes, "image/png");
    const created = actions.find((a) => a.action === "c2pa.created");
    expect(created).toBeDefined();
    expect(created?.digitalSourceType).toBe(TRAINED_ALGORITHMIC_MEDIA);
    expect(created?.softwareAgent?.name).toBe("test-image-model-1");
    expect(created?.when).toBeTruthy();

    const active = await activeManifestOf(signedBytes, "image/png");
    const generatorNames = (active?.claim_generator_info ?? []).map((g) => g.name);
    expect(generatorNames).toContain("gsengai-c2pa");
    const generatorAssertion = active?.assertions?.find(
      (a) => a.label === GENERATOR_ASSERTION_LABEL,
    );
    expect(generatorAssertion?.data).toMatchObject({ model: "test-image-model-1" });
  });

  it("signs a JPEG with the same assertions", async () => {
    const signer = newSigner();
    const result = await signer.signImage({ input: makeJpeg(), model: "test-image-model-1" });

    expect(Buffer.isBuffer(result.output)).toBe(true);
    const actions = await actionsOf(result.output as Buffer, "image/jpeg");
    const created = actions.find((a) => a.action === "c2pa.created");
    expect(created?.digitalSourceType).toBe(TRAINED_ALGORITHMIC_MEDIA);
  });

  it("buffer-input round-trip: Buffer in, Buffer out, manifest readable from the returned bytes", async () => {
    const signer = newSigner();
    const result = await signer.signImage({ input: makePng(), model: "m" });
    const summary = await readManifest(result.output as Buffer);
    expect(summary).not.toBeNull();
    expect(summary?.activeLabel).toBe(result.manifestLabel);
  });

  it("corrupt input throws regardless of failMode, and nothing is recorded", async () => {
    const garbage = Buffer.from("definitely not an image");
    for (const failMode of ["open", "strict"] as const) {
      const signer = newSigner({ failMode });
      await expect(signer.signImage({ input: garbage, model: "m" })).rejects.toThrow(
        /not a PNG or JPEG/,
      );
    }
    expect(store.count()).toBe(0);
  });
});

describe("signImage — evidence record per signing (PRD B6)", () => {
  it("writes a record with image modality, c2pa marking, manifest_ref = active label", async () => {
    const signer = newSigner();
    const result = await signer.signImage({
      input: makePng(),
      model: "test-image-model-1",
      promptHash: sha256Hex("prompt"),
      disclosureContext: "product-images",
    });

    expect(result.record).not.toBeNull();
    const record = result.record as NonNullable<typeof result.record>;
    expect(record.modality).toBe("image");
    expect(record.marking_methods).toEqual(["c2pa"]);
    expect(record.manifest_ref).toBe(result.manifestLabel);
    expect(record.system_id).toBe("test-system");
    expect(record.model).toBe("test-image-model-1");
    expect(record.prompt_hash).toBe(sha256Hex("prompt"));
    expect(record.disclosure_context).toBe("product-images");
    expect(record.output_hash_normalized).toBeNull();
    expect(store.count()).toBe(1);
  });

  it("output_hash equals sha256 of the signed output bytes (ADR-0018)", async () => {
    const signer = newSigner();
    const outPath = join(dir, "signed.png");
    const result = await signer.signImage({ input: makePng(), output: outPath, model: "m" });
    expect(result.record?.output_hash).toBe(sha256Hex(readFileSync(outPath)));
    expect(store.findByOutputHash(sha256Hex(readFileSync(outPath)))).toHaveLength(1);
  });

  it("hash chain verifies across interleaved text and image appends", async () => {
    const signer = newSigner();
    store.append({ modality: "text", model: "m", systemId: "s", outputText: "first text" });
    await signer.signImage({ input: makePng(), model: "m" });
    store.append({ modality: "text", model: "m", systemId: "s", outputText: "second text" });
    await signer.signImage({ input: makeJpeg(), model: "m" });

    const verification = store.verifyChain();
    expect(verification).toEqual({ ok: true, checked: 4 });
  });
});

describe("signImage — ingredient preservation (PRD B3, ADR-0015)", () => {
  it("re-signing chains the original manifest as parent ingredient: count 1, chain length 2, original label preserved", async () => {
    const signer = newSigner();
    const first = await signer.signImage({ input: makePng(), model: "model-a" });
    const second = await signer.signImage({ input: first.output as Buffer, model: "model-b" });

    expect(second.manifestLabel).not.toBe(first.manifestLabel);
    const summary = await readManifest(second.output as Buffer);
    expect(summary?.ingredientCount).toBe(1);
    expect(summary?.manifestLabels).toHaveLength(2);
    expect(summary?.manifestLabels).toContain(first.manifestLabel);
    expect(summary?.manifestLabels).toContain(second.manifestLabel);
  });

  it("never overwrites: the original manifest stays resolvable and the parent relationship is explicit", async () => {
    const signer = newSigner();
    const first = await signer.signImage({ input: makePng(), model: "model-a" });
    const second = await signer.signImage({ input: first.output as Buffer, model: "model-b" });

    const active = await activeManifestOf(second.output as Buffer, "image/png");
    const parent = active?.ingredients?.find((i) => i.relationship === "parentOf");
    expect(parent).toBeDefined();
    expect(parent?.active_manifest).toBe(first.manifestLabel);
    // the opened (not created) action ties the edit to the parent
    const actions = await actionsOf(second.output as Buffer, "image/png");
    expect(actions.some((a) => a.action === "c2pa.opened")).toBe(true);
    // model info still recorded on the edit path (ADR-0019)
    const generatorAssertion = active?.assertions?.find(
      (a) => a.label === GENERATOR_ASSERTION_LABEL,
    );
    expect(generatorAssertion?.data).toMatchObject({ model: "model-b" });
  });
});

describe("readManifest — validation status (PRD B4 honesty)", () => {
  it("dev-cert signature validates but the credential is untrusted — exact codes reported", async () => {
    const signer = newSigner();
    const result = await signer.signImage({ input: makePng(), model: "m" });
    const summary = await readManifest(result.output as Buffer);

    expect(summary?.validationStatusCodes.success).toContain("claimSignature.validated");
    expect(summary?.validationStatusCodes.failure).toContain("signingCredential.untrusted");
  });

  it("returns null for an asset without a manifest", async () => {
    expect(await readManifest(makePng())).toBeNull();
  });
});

describe("signImage — failure semantics (ADR-0017)", () => {
  function brokenStore(): EvidenceStore {
    return {
      ...store,
      append: () => {
        throw new Error("simulated store failure");
      },
    };
  }

  it("fail-open: store failure still returns the signed asset, warns loudly, counts the loss", async () => {
    resetLostRecordCount();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const signer = newSigner({ store: brokenStore() });

    const result = await signer.signImage({ input: makePng(), model: "m" });
    expect(result.record).toBeNull();
    expect(result.manifestLabel).toMatch(/^urn:c2pa:/);
    expect((await readManifest(result.output as Buffer))?.activeLabel).toBe(result.manifestLabel);
    expect(getLostRecordCount()).toBe(1);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("Evidence record LOST"))).toBe(
      true,
    );
  });

  it("strict: store failure throws", async () => {
    const signer = newSigner({ store: brokenStore(), failMode: "strict" });
    await expect(signer.signImage({ input: makePng(), model: "m" })).rejects.toThrow(
      "simulated store failure",
    );
  });
});

describe("privacy canary — media (PRD C4). Never delete, skip, or weaken this test.", () => {
  it("a sentinel byte string embedded in the source PNG appears in no DB/WAL/SHM file", async () => {
    const sentinel = "A50C_CANARY_SENTINEL_do-not-persist-raw-media-bytes";
    const png = makePng(sentinel);
    // positive control: the sentinel really is in the source image bytes
    expect(png.includes(Buffer.from(sentinel))).toBe(true);

    const dbPath = join(dir, "evidence.db");
    const signer = newSigner();
    const outPath = join(dir, "signed.png");
    await signer.signImage({ input: png, output: outPath, model: "m" });
    // positive control: the sentinel survived signing into the output asset
    expect(readFileSync(outPath).includes(Buffer.from(sentinel))).toBe(true);

    store.close();
    open = false;
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = dbPath + suffix;
      if (existsSync(file)) {
        expect(readFileSync(file).includes(Buffer.from(sentinel))).toBe(false);
      }
    }
  });
});

describe("input validation", () => {
  it("createImageSigner requires a non-empty systemId and readable cert paths", () => {
    expect(() => createImageSigner({ store, systemId: "" })).toThrow(TypeError);
    expect(() =>
      createImageSigner({ store, systemId: "s", certPath: join(dir, "missing.pem") }),
    ).toThrow();
  });

  it("signImage requires a non-empty model", async () => {
    const signer = newSigner();
    await expect(signer.signImage({ input: makePng(), model: "" })).rejects.toThrow(TypeError);
  });

  it("a signed file written to disk round-trips through path input", async () => {
    const inPath = join(dir, "in.png");
    writeFileSync(inPath, makePng());
    const signer = newSigner();
    const outPath = join(dir, "out.png");
    const result = await signer.signImage({ input: inPath, output: outPath, model: "m" });
    expect((await readManifest(outPath))?.activeLabel).toBe(result.manifestLabel);
  });
});
