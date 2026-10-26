// SPDX-License-Identifier: Apache-2.0
// Adversarial inputs for the manifest-certificate parser (ADR-0040), driven
// through readManifest. The backend is stubbed with a fixed validation result
// ("the backend validated manifest LABEL, signed by X"): the real backends
// refuse most of these byte structures before the parser runs (two stores →
// "more than one manifest store detected", see signer-cert.test.ts), and the
// point here is what the parser does if a backend ever hands it such bytes.
// Every case asserts that readManifest resolves (never throws) within
// TIME_BOUND_MS; every malformed case asserts the flag is null. Well-formed
// controls sit next to the attacks so a null can only come from the defect.
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ManifestSummary, readManifest } from "@gsengai/c2pa";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestStoreJson, SignatureInfoJson } from "../src/backend";
import {
  app11,
  app11Segments,
  box,
  box64,
  type CborValue,
  COSE_ALG,
  COSE_X5CHAIN,
  cbor,
  cborHead,
  cose,
  coseRaw,
  ES256,
  generateChain,
  jpegWithSegments,
  jpegXtHeader,
  manifestBox,
  pngWithChunks,
  pngWithStores,
  reportedSigner,
  signatureBox,
  storeBox,
  superbox,
  u32,
} from "./c2pa-builders";
import { chunk } from "./fixtures";

const validation = vi.hoisted(() => ({ store: null as unknown }));

vi.mock("../src/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/backend")>();
  return {
    ...actual,
    resolveBackend: async () => ({
      name: "native",
      peekStore: async () => validation.store,
      validateStore: async () => validation.store,
      sign: async () => {
        throw new Error("the stub backend does not sign");
      },
    }),
  };
});

const TIME_BOUND_MS = 1000;
const LABEL = "urn:c2pa:00000000-0000-4000-8000-00000000ad01";
const DEV_CHAIN = fileURLToPath(new URL("../dev-certs/dev-cert-chain.pem", import.meta.url));
const DEV_LEAF = new X509Certificate(readFileSync(DEV_CHAIN));
const DEV = DEV_LEAF.raw;

let otherDir: string;
let OTHER_LEAF: X509Certificate;
let OTHER: Buffer;

beforeAll(() => {
  otherDir = mkdtempSync(join(tmpdir(), "gsengai-adversarial-"));
  OTHER_LEAF = generateChain(otherDir, {
    root: "/C=US/O=gsengai test/CN=adversarial root - NOT TRUSTED",
    leaf: "/C=US/O=gsengai test/CN=adversarial signer - NOT TRUSTED",
  }).leaf;
  OTHER = OTHER_LEAF.raw;
});

afterAll(() => {
  rmSync(otherDir, { recursive: true, force: true });
});

/** Stub: the backend validated manifest `label`, reporting `signer` as c2pa-rs would. */
function validatedBy(signer: SignatureInfoJson | null | undefined, label = LABEL): void {
  const store: ManifestStoreJson = {
    active_manifest: label,
    manifests: { [label]: { signature_info: signer } },
    validation_state: "Valid",
    validation_results: {
      activeManifest: { success: [{ code: "claimSignature.validated" }], failure: [] },
    },
  };
  validation.store = store;
}

beforeEach(() => {
  validatedBy(reportedSigner(DEV_LEAF));
});

async function readBounded(asset: Buffer): Promise<ManifestSummary> {
  const started = performance.now();
  const outcome = await readManifest(asset).then(
    (summary) => ({ summary, error: undefined }),
    (error: unknown) => ({ summary: undefined, error }),
  );
  const elapsed = performance.now() - started;
  expect(outcome.error, "readManifest must not throw").toBeUndefined();
  expect(elapsed, `readManifest must finish within ${TIME_BOUND_MS} ms`).toBeLessThan(
    TIME_BOUND_MS,
  );
  expect(outcome.summary).not.toBeNull();
  return outcome.summary as ManifestSummary;
}

async function flagOf(asset: Buffer): Promise<boolean | null> {
  return (await readBounded(asset)).signedWithDevCertificate;
}

/** One manifest, one signature, the given COSE payload. */
function store(coseBytes: Buffer, label = LABEL): Buffer {
  return storeBox([manifestBox(label, [signatureBox(coseBytes)])]);
}

/** A copy of `buffer` with the 32-bit big-endian value at `offset` replaced. */
function withU32(buffer: Buffer, offset: number, value: number): Buffer {
  const copy = Buffer.from(buffer);
  copy.writeUInt32BE(value, offset);
  return copy;
}

/** Offset of a superbox's first content box (right after its jumd description box). */
function firstChildOffset(superboxBytes: Buffer): number {
  return 8 + superboxBytes.readUInt32BE(8);
}

/** A protected header: alg ES256 plus the given raw x5chain value bytes. */
function protectedWithX5chain(x5chainValue: Buffer): Buffer {
  return Buffer.concat([
    cborHead(5, 2),
    cbor(COSE_ALG),
    cbor(ES256),
    cbor(COSE_X5CHAIN),
    x5chainValue,
  ]);
}

const EMPTY_MAP = cbor(new Map());

describe("controls: well-formed synthetic stores are read (so every null below is the defect's)", () => {
  it("PNG, dev-signed → true; signed with another certificate → false", async () => {
    expect(await flagOf(pngWithStores(store(cose(DEV))))).toBe(true);
    validatedBy(reportedSigner(OTHER_LEAF));
    expect(await flagOf(pngWithStores(store(cose(OTHER))))).toBe(false);
  });

  it("JPEG, single segment and split across many in-order segments → true", async () => {
    expect(await flagOf(jpegWithSegments(app11Segments(store(cose(DEV)), 1)))).toBe(true);
    const segments = app11Segments(store(cose(DEV)), 1, 97);
    expect(segments.length).toBeGreaterThan(4);
    expect(await flagOf(jpegWithSegments(segments))).toBe(true);
  });

  it("x5chain in the unprotected header only → true (exactly one header carries it)", async () => {
    const unprotected = cbor(new Map<CborValue, CborValue>([[COSE_X5CHAIN, [DEV]]]));
    const protectedOnlyAlg = cbor(new Map<CborValue, CborValue>([[COSE_ALG, ES256]]));
    expect(await flagOf(pngWithStores(store(coseRaw(protectedOnlyAlg, unprotected))))).toBe(true);
  });
});

describe("two embedded stores, same manifest label, different signing certificates", () => {
  const signers = () =>
    [
      ["the dev-signed store", reportedSigner(DEV_LEAF)],
      ["the other store", reportedSigner(OTHER_LEAF)],
    ] as const;

  it("PNG with two caBX chunks: null whichever store the backend validated, in either order", async () => {
    for (const [, signer] of signers()) {
      validatedBy(signer);
      expect(await flagOf(pngWithStores(store(cose(DEV)), store(cose(OTHER))))).toBeNull();
      expect(await flagOf(pngWithStores(store(cose(OTHER)), store(cose(DEV))))).toBeNull();
    }
  });

  it("JPEG with two JUMBF manifest stores (distinct box instances): null either way", async () => {
    for (const [, signer] of signers()) {
      validatedBy(signer);
      const asset = jpegWithSegments([
        ...app11Segments(store(cose(DEV)), 1),
        ...app11Segments(store(cose(OTHER)), 2),
      ]);
      expect(await flagOf(asset)).toBeNull();
    }
  });

  it("JPEG with a second box labelled c2pa but not typed as a manifest store: null", async () => {
    const lookalike = superbox("c2pa", "xxxx", [manifestBox(LABEL, [signatureBox(cose(OTHER))])]);
    const asset = jpegWithSegments([
      ...app11Segments(store(cose(DEV)), 1),
      ...app11Segments(lookalike, 2),
    ]);
    expect(await flagOf(asset)).toBeNull();
  });

  it("one store holding two manifests with the same label: null", async () => {
    const duplicated = storeBox([
      manifestBox(LABEL, [signatureBox(cose(DEV))]),
      manifestBox(LABEL, [signatureBox(cose(OTHER))]),
    ]);
    expect(await flagOf(pngWithStores(duplicated))).toBeNull();
  });

  it("one manifest holding two signature boxes: null", async () => {
    const twoSignatures = storeBox([
      manifestBox(LABEL, [signatureBox(cose(DEV)), signatureBox(cose(OTHER))]),
    ]);
    expect(await flagOf(pngWithStores(twoSignatures))).toBeNull();
  });
});

describe("box length pointing past the end of the data", () => {
  it.each([
    ["the manifest store box", () => pngWithStores(withU32(store(cose(DEV)), 0, 0x7fff_ffff))],
    [
      "a manifest box inside the store",
      () => {
        const bytes = store(cose(DEV));
        return pngWithStores(withU32(bytes, firstChildOffset(bytes), bytes.length * 4));
      },
    ],
    [
      "the CBOR box inside the signature box",
      () => {
        const coseBytes = cose(DEV);
        const lying = box("cbor", coseBytes, coseBytes.length + 8 + 64);
        return pngWithStores(storeBox([manifestBox(LABEL, [signatureBox(coseBytes, lying)])]));
      },
    ],
    [
      "the PNG caBX chunk",
      () => pngWithChunks([withU32(chunk("caBX", store(cose(DEV))), 0, 0x0fff_ffff)]),
    ],
    [
      "a JPEG APP11 segment",
      () => {
        const segment = app11Segments(store(cose(DEV)), 1)[0] as Buffer;
        const lying = Buffer.from(segment);
        lying.writeUInt16BE(0xffff, 2);
        return jpegWithSegments([lying]);
      },
    ],
  ])("%s → null", async (_name, build) => {
    expect(await flagOf(build())).toBeNull();
  });
});

describe("64-bit box length (LBox = 1, XLBox)", () => {
  const sigWith = (cborBox: Buffer) =>
    pngWithStores(storeBox([manifestBox(LABEL, [signatureBox(cose(DEV), cborBox)])]));

  it.each([
    ["XLBox = 2^64 - 1", 2n ** 64n - 1n],
    ["XLBox = 2^53 + 1 (beyond exact Number range)", 2n ** 53n + 1n],
    ["XLBox one byte past the data", -1n],
    ["XLBox smaller than its own 16-byte header", 8n],
  ])("%s → null", async (_name, declared) => {
    const coseBytes = cose(DEV);
    const xlbox = declared === -1n ? BigInt(16 + coseBytes.length + 1) : declared;
    expect(await flagOf(sigWith(box64("cbor", coseBytes, xlbox)))).toBeNull();
  });

  it("LBox = 1 with the XLBox field itself truncated → null", async () => {
    const truncated = Buffer.concat([u32(1), Buffer.from("cbor", "latin1"), Buffer.alloc(4)]);
    expect(await flagOf(sigWith(truncated))).toBeNull();
  });

  it("control: a well-formed 64-bit length is accepted → true", async () => {
    expect(await flagOf(sigWith(box64("cbor", cose(DEV))))).toBe(true);
  });
});

describe("CBOR claiming a huge item count", () => {
  const HUGE = 2n ** 64n - 1n;

  it.each([
    [
      "protected-header map claiming 2^64 - 1 entries",
      () =>
        coseRaw(
          Buffer.concat([
            cborHead(5, HUGE),
            cbor(COSE_ALG),
            cbor(ES256),
            cbor(COSE_X5CHAIN),
            cbor([DEV]),
          ]),
          EMPTY_MAP,
        ),
    ],
    [
      "x5chain array claiming 2^32 items",
      () =>
        coseRaw(protectedWithX5chain(Buffer.concat([cborHead(4, 2 ** 32), cbor(DEV)])), EMPTY_MAP),
    ],
    [
      "COSE_Sign1 array claiming 2^64 - 1 items",
      () =>
        Buffer.concat([
          cborHead(6, 18),
          cborHead(4, HUGE),
          cbor(cbor(new Map<CborValue, CborValue>([[COSE_X5CHAIN, [DEV]]]))),
          EMPTY_MAP,
        ]),
    ],
    [
      "certificate byte string claiming 2^64 - 1 bytes",
      () =>
        coseRaw(
          protectedWithX5chain(Buffer.concat([cborHead(4, 1), cborHead(2, HUGE), DEV])),
          EMPTY_MAP,
        ),
    ],
    [
      "unterminated indefinite-length array",
      () =>
        coseRaw(protectedWithX5chain(Buffer.concat([Buffer.from([0x9f]), cbor(DEV)])), EMPTY_MAP),
    ],
    [
      "unprotected map claiming 2^64 - 1 entries, followed by ~1 MB of real entries",
      () => {
        const entries: Buffer[] = [cborHead(5, HUGE)];
        for (let key = 0; key < 200_000; key += 1) {
          entries.push(cborHead(0, key), Buffer.from([0x00]));
        }
        return coseRaw(
          cbor(new Map<CborValue, CborValue>([[COSE_X5CHAIN, [DEV]]])),
          Buffer.concat(entries),
        );
      },
    ],
  ])("%s → null", async (_name, build) => {
    expect(await flagOf(pngWithStores(store(build())))).toBeNull();
  });
});

describe("CBOR nested past the depth limit", () => {
  const DEEP = 100_000;

  it.each([
    [
      "100k nested arrays as the x5chain value",
      () =>
        coseRaw(
          protectedWithX5chain(Buffer.concat([Buffer.alloc(DEEP, 0x81), Buffer.from([0x00])])),
          EMPTY_MAP,
        ),
    ],
    [
      "50k nested maps in the unprotected header",
      () => {
        const nested = Buffer.concat([
          Buffer.alloc(2 * 50_000, Buffer.from([0xa1, 0x01])),
          Buffer.from([0x00]),
        ]);
        return coseRaw(cbor(new Map<CborValue, CborValue>([[COSE_X5CHAIN, [DEV]]])), nested);
      },
    ],
    [
      "100k nested tags",
      () =>
        coseRaw(
          protectedWithX5chain(Buffer.concat([Buffer.alloc(DEEP, 0xc6), cbor([DEV])])),
          EMPTY_MAP,
        ),
    ],
    [
      "100k nested indefinite-length arrays",
      () =>
        coseRaw(
          protectedWithX5chain(Buffer.concat([Buffer.alloc(DEEP, 0x9f), Buffer.from([0x00])])),
          EMPTY_MAP,
        ),
    ],
  ])("%s → null", async (_name, build) => {
    expect(await flagOf(pngWithStores(store(build())))).toBeNull();
  });

  it("40 levels in an unrelated header value — just past the limit, far from any stack limit → null", async () => {
    const pad = Buffer.concat([Buffer.alloc(40, 0x81), Buffer.from([0x00])]);
    const unprotected = Buffer.concat([cborHead(5, 1), cbor("pad"), pad]);
    expect(
      await flagOf(pngWithStores(store(coseRaw(protectedWithX5chain(cbor([DEV])), unprotected)))),
    ).toBeNull();
  });

  it("control: 20 levels of nesting in an unrelated header value is within the limit → true", async () => {
    const pad = Buffer.concat([Buffer.alloc(20, 0x81), Buffer.from([0x00])]);
    const unprotected = Buffer.concat([cborHead(5, 1), cbor("pad"), pad]);
    expect(
      await flagOf(pngWithStores(store(coseRaw(protectedWithX5chain(cbor([DEV])), unprotected)))),
    ).toBe(true);
  });
});

describe("signature with no usable x5chain header", () => {
  const only = (header: Map<CborValue, CborValue>) => coseRaw(cbor(header), EMPTY_MAP);

  it.each([
    ["no x5chain at all", () => only(new Map<CborValue, CborValue>([[COSE_ALG, ES256]]))],
    ["x5chain is an empty array", () => only(new Map<CborValue, CborValue>([[COSE_X5CHAIN, []]]))],
    ["x5chain is an integer", () => only(new Map<CborValue, CborValue>([[COSE_X5CHAIN, 42]]))],
    [
      "x5chain is an empty byte string",
      () => only(new Map<CborValue, CborValue>([[COSE_X5CHAIN, Buffer.alloc(0)]])),
    ],
    [
      "x5chain under a text label instead of 33",
      () => only(new Map<CborValue, CborValue>([["x5chain", [DEV]]])),
    ],
    [
      "x5chain in both the protected and the unprotected header (same certificate)",
      () =>
        coseRaw(
          cbor(new Map<CborValue, CborValue>([[COSE_X5CHAIN, [DEV]]])),
          cbor(new Map<CborValue, CborValue>([[COSE_X5CHAIN, [DEV]]])),
        ),
    ],
    [
      "x5chain twice in the protected header (duplicate map key, same certificate)",
      () =>
        coseRaw(
          Buffer.concat([
            cborHead(5, 2),
            cbor(COSE_X5CHAIN),
            cbor([DEV]),
            cbor(COSE_X5CHAIN),
            cbor([DEV]),
          ]),
          EMPTY_MAP,
        ),
    ],
    [
      "x5chain leaf is not a certificate",
      () => only(new Map<CborValue, CborValue>([[COSE_X5CHAIN, [Buffer.from("not DER")]]])),
    ],
    [
      "tag other than COSE_Sign1 (18)",
      () => Buffer.concat([cborHead(6, 17), cose(DEV).subarray(1)]),
    ],
    ["trailing byte after the COSE_Sign1", () => Buffer.concat([cose(DEV), Buffer.from([0x00])])],
  ])("%s → null", async (_name, build) => {
    expect(await flagOf(pngWithStores(store(build())))).toBeNull();
  });
});

describe("cross-check against the signer the backend reported", () => {
  const asset = () => pngWithStores(store(cose(DEV)));

  it.each([
    ["no signature_info (undefined)", undefined],
    ["no signature_info (null)", null],
    ["no serial number", { issuer: reportedSigner(DEV_LEAF).issuer }],
    ["no organization", { cert_serial_number: reportedSigner(DEV_LEAF).cert_serial_number }],
    ["a different serial number", { ...reportedSigner(DEV_LEAF), cert_serial_number: "1" }],
    ["a different organization", { ...reportedSigner(DEV_LEAF), issuer: "Someone Else" }],
  ] as [string, SignatureInfoJson | null | undefined][])("%s → null", async (_name, signer) => {
    validatedBy(signer);
    expect(await flagOf(asset())).toBeNull();
  });

  it("the backend reports another signer than the certificate in the single embedded store → null", async () => {
    validatedBy(reportedSigner(OTHER_LEAF));
    expect(await flagOf(asset())).toBeNull();
  });
});

describe("JPEG XT segment sequencing", () => {
  const parts = () => app11Segments(store(cose(DEV)), 1, 120);

  it.each([
    ["continuation before the first segment", (s: Buffer[]) => [s[1], s[0], ...s.slice(2)]],
    ["a continuation repeated", (s: Buffer[]) => [s[0], s[1], s[1], ...s.slice(2)]],
    ["a continuation skipped", (s: Buffer[]) => [s[0], ...s.slice(2)]],
    [
      "a continuation repeating a different box header",
      (s: Buffer[]) => {
        const altered = Buffer.from(s[1] as Buffer);
        altered.writeUInt32BE(0x0bad_0bad, 4 + 8); // LBox of the repeated header
        return [s[0], altered, ...s.slice(2)];
      },
    ],
    [
      "two boxes sharing one instance number",
      (s: Buffer[]) => [...s, app11(Buffer.concat([jpegXtHeader(1, 1), store(cose(OTHER))]))],
    ],
  ])("%s → null", async (_name, reorder) => {
    expect(await flagOf(jpegWithSegments(reorder(parts()) as Buffer[]))).toBeNull();
  });
});
