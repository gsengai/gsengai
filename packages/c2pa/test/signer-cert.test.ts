// SPDX-License-Identifier: Apache-2.0
// Signer-certificate fingerprints (ADR-0039): every signing records the leaf
// certificate's SHA-256 as signer_cert_sha256, and readManifest flags
// manifests signed with the bundled dev certificate — by fingerprint, for the
// active manifest only. A second chain is generated per run into a temp dir
// (never committed) so "signed with something else" is a real signature.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createImageSigner, readManifest } from "@gsengai/c2pa";
import { createEvidenceStore, type EvidenceStore } from "@gsengai/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBackend } from "../src/backend";
import { manifestSigningCertificate } from "../src/jumbf";
import { generateChain, jpegApp11, pngChunks } from "./c2pa-builders";
import { makeJpeg, makePng } from "./fixtures";

const DEV_CERT_FILE = fileURLToPath(new URL("../dev-certs/dev-cert-chain.pem", import.meta.url));
const GEN_CERTS_SCRIPT = fileURLToPath(
  new URL("../../../scripts/gen-dev-certs.sh", import.meta.url),
);
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/** Leaf fingerprint computed independently of src/cert.ts. */
function leafSha256(chainPath: string): string {
  const leaf = readFileSync(chainPath, "utf8").split("-----END CERTIFICATE-----")[0];
  return new X509Certificate(`${leaf}-----END CERTIFICATE-----`).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
}

const DEV_LEAF_SHA256 = leafSha256(DEV_CERT_FILE);

let otherDir: string;
let otherCert: string;
let otherKey: string;
let otherLeafSha256: string;

beforeAll(() => {
  otherDir = mkdtempSync(join(tmpdir(), "gsengai-other-cert-"));
  execFileSync("bash", [GEN_CERTS_SCRIPT, otherDir], { stdio: "ignore" });
  otherCert = join(otherDir, "dev-cert-chain.pem");
  otherKey = join(otherDir, "dev-private-key.pem");
  otherLeafSha256 = leafSha256(otherCert);
});

afterAll(() => {
  rmSync(otherDir, { recursive: true, force: true });
});

let dir: string;
let store: EvidenceStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-signer-cert-"));
  store = createEvidenceStore({ path: join(dir, "evidence.db") });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function devSigner() {
  return createImageSigner({ store, systemId: "s", devCertificates: true });
}

function otherSigner() {
  return createImageSigner({ store, systemId: "s", certPath: otherCert, keyPath: otherKey });
}

describe("signer_cert_sha256 on every signing (ADR-0039)", () => {
  it("the second chain really is a different certificate", () => {
    expect(otherLeafSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(otherLeafSha256).not.toBe(DEV_LEAF_SHA256);
  });

  it("dev opt-in records the dev leaf fingerprint, for PNG and JPEG", async () => {
    const signer = devSigner();
    for (const input of [makePng(), makeJpeg()]) {
      const { record } = await signer.signImage({ input, model: "m" });
      expect(record?.signer_cert_sha256).toBe(DEV_LEAF_SHA256);
    }
    expect(store.verifyChain()).toEqual({ ok: true, checked: 2 });
  });

  it("own certificate paths record that certificate's leaf fingerprint; text records stay null", async () => {
    const { record } = await otherSigner().signImage({ input: makePng(), model: "m" });
    expect(record?.signer_cert_sha256).toBe(otherLeafSha256);
    const text = store.append({ modality: "text", model: "m", systemId: "s", outputText: "t" });
    expect(text.signer_cert_sha256).toBeNull();
    expect(store.verifyChain()).toEqual({ ok: true, checked: 2 });
  });

  it("the record's fingerprint matches the certificate embedded in the signed manifest", async () => {
    const signed = await otherSigner().signImage({ input: makeJpeg(), model: "m" });
    const embedded = manifestSigningCertificate(
      signed.output as Buffer,
      "image/jpeg",
      signed.manifestLabel,
    );
    expect(embedded).not.toBeNull();
    const fingerprint = new X509Certificate(embedded as Buffer).fingerprint256;
    expect(fingerprint.replaceAll(":", "").toLowerCase()).toBe(signed.record?.signer_cert_sha256);
  });
});

describe("readManifest — signedWithDevCertificate (ADR-0039)", () => {
  it("is true for a dev-signed manifest and false for one signed with another certificate", async () => {
    for (const input of [makePng(), makeJpeg()]) {
      const dev = await devSigner().signImage({ input, model: "m" });
      expect((await readManifest(dev.output as Buffer))?.signedWithDevCertificate).toBe(true);
      const other = await otherSigner().signImage({ input, model: "m" });
      expect((await readManifest(other.output as Buffer))?.signedWithDevCertificate).toBe(false);
    }
  });

  it("considers the active manifest only — not dev-signed parent ingredients", async () => {
    const devFirst = await devSigner().signImage({ input: makePng(), model: "m" });
    const resignedByOther = await otherSigner().signImage({
      input: devFirst.output as Buffer,
      model: "m",
    });
    const summary = await readManifest(resignedByOther.output as Buffer);
    expect(summary?.manifestLabels).toContain(devFirst.manifestLabel);
    expect(summary?.signedWithDevCertificate).toBe(false);

    const resignedByDev = await devSigner().signImage({
      input: resignedByOther.output as Buffer,
      model: "m",
    });
    expect((await readManifest(resignedByDev.output as Buffer))?.signedWithDevCertificate).toBe(
      true,
    );
  });

  it("the dev fingerprint is computed at runtime from the shipped chain, never hardcoded", () => {
    for (const file of readdirSync(SRC_DIR)) {
      const source = readFileSync(join(SRC_DIR, file), "utf8").toLowerCase();
      expect(source.includes(DEV_LEAF_SHA256), file).toBe(false);
      expect(source.includes(DEV_LEAF_SHA256.match(/../gu)?.join(":") ?? ""), file).toBe(false);
    }
  });
});

describe("readManifest — bound to the signer the validator reported (ADR-0040), real backends", () => {
  it("compares the signer's subject organization, which c2pa-rs reports as `issuer`", async () => {
    // Subject O differs from the issuer's O, repeats, and contains a comma:
    // comparing against the issuer DN or the escaped DN string would yield null.
    const odd = generateChain(join(otherDir, "odd"), {
      root: "/C=US/O=Root Issuer Org/CN=gsengai test root - NOT TRUSTED",
      leaf: "/C=US/O=Acme, Inc./O=Second Signer Org/CN=gsengai test signer - NOT TRUSTED",
    });
    const signed = await createImageSigner({
      store,
      systemId: "s",
      certPath: odd.certPath,
      keyPath: odd.keyPath,
    }).signImage({ input: makePng(), model: "m" });

    const backend = await resolveBackend();
    const validated = await backend.validateStore(signed.output as Buffer, "image/png");
    expect(validated?.manifests?.[signed.manifestLabel]?.signature_info).toMatchObject({
      issuer: "Second Signer Org",
      cert_serial_number: BigInt(`0x${odd.leaf.serialNumber}`).toString(),
    });
    // Determined (false), not unknown (null).
    expect((await readManifest(signed.output as Buffer))?.signedWithDevCertificate).toBe(false);
  });

  it("both backends refuse an asset carrying two manifest stores, before any flag is computed", async () => {
    const dev = devSigner();
    const other = otherSigner();
    const pngA = (await dev.signImage({ input: makePng(), model: "m" })).output as Buffer;
    const pngB = (await other.signImage({ input: makePng(), model: "m" })).output as Buffer;
    const secondStore = pngChunks(pngB).find((c) => c.type === "caBX")?.raw as Buffer;
    const twoPng = Buffer.concat([
      pngA.subarray(0, 8),
      ...pngChunks(pngA).flatMap((c) => (c.type === "caBX" ? [c.raw, secondStore] : [c.raw])),
    ]);
    await expect(readManifest(twoPng)).rejects.toThrow(/more than one manifest store/u);

    const jpegA = (await dev.signImage({ input: makeJpeg(), model: "m" })).output as Buffer;
    const jpegB = (await other.signImage({ input: makeJpeg(), model: "m" })).output as Buffer;
    const { end } = jpegApp11(jpegA);
    const renumbered = jpegApp11(jpegB).segments.map((segment) => {
      const copy = Buffer.from(segment);
      copy.writeUInt16BE(copy.readUInt16BE(6) + 1, 6); // a distinct JPEG XT box instance (En)
      return copy;
    });
    const twoJpeg = Buffer.concat([jpegA.subarray(0, end), ...renumbered, jpegA.subarray(end)]);
    await expect(readManifest(twoJpeg)).rejects.toThrow(/more than one manifest store/u);
  });
});

describe("manifest certificate extraction is defensive", () => {
  it("never throws on truncated or corrupted assets — it yields null or a certificate", async () => {
    for (const [mimeType, input] of [
      ["image/png", makePng()],
      ["image/jpeg", makeJpeg()],
    ] as const) {
      const signed = await devSigner().signImage({ input, model: "m" });
      const bytes = signed.output as Buffer;
      for (let cut = 0; cut < bytes.length; cut += 97) {
        expect(() =>
          manifestSigningCertificate(bytes.subarray(0, cut), mimeType, signed.manifestLabel),
        ).not.toThrow();
      }
      for (let at = 0; at < bytes.length; at += 89) {
        const corrupted = Buffer.from(bytes);
        corrupted[at] = (corrupted[at] ?? 0) ^ 0xff;
        expect(() =>
          manifestSigningCertificate(corrupted, mimeType, signed.manifestLabel),
        ).not.toThrow();
      }
      expect(manifestSigningCertificate(input, mimeType, signed.manifestLabel)).toBeNull();
      expect(manifestSigningCertificate(bytes, mimeType, "urn:c2pa:not-in-store")).toBeNull();
    }
  });
});
