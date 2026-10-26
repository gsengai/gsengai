// SPDX-License-Identifier: Apache-2.0
// Byte-level builders for C2PA containers in tests (ADR-0040): JUMBF boxes,
// minimal CBOR/COSE, PNG caBX and JPEG APP11 splicing, and throwaway signing
// chains generated with openssl into a temp dir (never committed). Everything
// here is deliberately low-level so tests can produce exactly the malformed
// structure they target.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chunk, makeJpeg, makePng } from "./fixtures";

/** C2PA JUMBF type UUIDs: a four-character prefix + the ISO 19566-5 suffix. */
const UUID_SUFFIX = Buffer.from("00110010800000aa00389b71", "hex");

export function u32(n: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(n);
  return out;
}

/** A box with a 32-bit length (LBox) — or `lbox` to lie about it. */
export function box(type: string, payload: Buffer, lbox = 8 + payload.length): Buffer {
  return Buffer.concat([u32(lbox), Buffer.from(type, "latin1"), payload]);
}

/** A box with a 64-bit length (LBox = 1, XLBox) — or `xlbox` to lie about it. */
export function box64(type: string, payload: Buffer, xlbox = BigInt(16 + payload.length)): Buffer {
  const extended = Buffer.alloc(8);
  extended.writeBigUInt64BE(xlbox);
  return Buffer.concat([u32(1), Buffer.from(type, "latin1"), extended, payload]);
}

export function superbox(label: string, type4: string, children: Buffer[]): Buffer {
  const description = Buffer.concat([
    Buffer.from(type4, "latin1"),
    UUID_SUFFIX,
    Buffer.from([0x03]), // requestable + label present
    Buffer.from(`${label}\0`, "utf8"),
  ]);
  return box("jumb", Buffer.concat([box("jumd", description), ...children]));
}

export function signatureBox(cose: Buffer, cborBox = box("cbor", cose)): Buffer {
  return superbox("c2pa.signature", "c2cs", [cborBox]);
}

export function manifestBox(label: string, children: Buffer[]): Buffer {
  return superbox(label, "c2ma", [superbox("c2pa.assertions", "c2as", []), ...children]);
}

export function storeBox(manifests: Buffer[]): Buffer {
  return superbox("c2pa", "c2pa", manifests);
}

// ---- CBOR -----------------------------------------------------------------

export type CborValue =
  | number
  | string
  | null
  | Buffer
  | CborValue[]
  | Map<CborValue, CborValue>
  | { tag: number; value: CborValue };

/** Initial byte(s) for major type `major` with argument `n`. */
export function cborHead(major: number, n: number | bigint): Buffer {
  const value = BigInt(n);
  const m = major << 5;
  if (value < 24n) {
    return Buffer.from([m | Number(value)]);
  }
  for (const [info, width] of [
    [24, 1],
    [25, 2],
    [26, 4],
    [27, 8],
  ] as const) {
    if (value < 1n << BigInt(8 * width) || width === 8) {
      const out = Buffer.alloc(1 + width);
      out[0] = m | info;
      if (width === 8) {
        out.writeBigUInt64BE(value, 1);
      } else {
        out.writeUIntBE(Number(value), 1, width);
      }
      return out;
    }
  }
  throw new RangeError("unreachable");
}

export function cbor(value: CborValue): Buffer {
  if (value === null) {
    return Buffer.from([0xf6]);
  }
  if (typeof value === "number") {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([cborHead(2, value.length), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(cbor)]);
  }
  if (value instanceof Map) {
    return Buffer.concat([
      cborHead(5, value.size),
      ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]),
    ]);
  }
  return Buffer.concat([cborHead(6, value.tag), cbor(value.value)]);
}

export const COSE_ALG = 1;
export const COSE_X5CHAIN = 33;
export const ES256 = -7;

/** COSE_Sign1_Tagged with the given raw protected-header bytes and unprotected header (pre-encoded). */
export function coseRaw(protectedBytes: Buffer, unprotected: Buffer): Buffer {
  return Buffer.concat([
    cborHead(6, 18),
    cborHead(4, 4),
    cbor(protectedBytes),
    unprotected,
    cbor(null),
    cbor(Buffer.alloc(64, 0x5a)), // the signature bytes are never verified by the parser
  ]);
}

/** A well-formed COSE_Sign1 whose protected header carries `x5chain: [leaf]`. */
export function cose(leafDer: Buffer): Buffer {
  return coseRaw(
    cbor(
      new Map<CborValue, CborValue>([
        [COSE_ALG, ES256],
        [COSE_X5CHAIN, [leafDer]],
      ]),
    ),
    cbor(new Map()),
  );
}

// ---- containers -----------------------------------------------------------

const PNG_SIGNATURE_AND_IHDR = 8 + 25;

/** A valid PNG with the given raw chunks inserted right after IHDR. */
export function pngWithChunks(chunks: Buffer[]): Buffer {
  const png = makePng();
  return Buffer.concat([
    png.subarray(0, PNG_SIGNATURE_AND_IHDR),
    ...chunks,
    png.subarray(PNG_SIGNATURE_AND_IHDR),
  ]);
}

export function pngWithStores(...stores: Buffer[]): Buffer {
  return pngWithChunks(stores.map((store) => chunk("caBX", store)));
}

/** Raw chunks (length + type + data + CRC) of a PNG, in file order. */
export function pngChunks(png: Buffer): { type: string; raw: Buffer }[] {
  const out: { type: string; raw: Buffer }[] = [];
  let pos = 8;
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    out.push({
      type: png.toString("latin1", pos + 4, pos + 8),
      raw: png.subarray(pos, pos + 12 + length),
    });
    pos += 12 + length;
  }
  return out;
}

/** One APP11 marker segment around a JPEG XT payload. */
export function app11(payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(2 + payload.length);
  return Buffer.concat([Buffer.from([0xff, 0xeb]), length, payload]);
}

/** JPEG XT packet header: CI "JP", box instance En, sequence Z. */
export function jpegXtHeader(en: number, z: number): Buffer {
  const out = Buffer.alloc(8);
  out.write("JP", 0, "latin1");
  out.writeUInt16BE(en, 2);
  out.writeUInt32BE(z, 4);
  return out;
}

/**
 * Split one JUMBF box into APP11 segments of at most `chunkSize` box bytes:
 * Z = 1, 2, …; continuations repeat the box's LBox/TBox header.
 */
export function app11Segments(jumbf: Buffer, en: number, chunkSize = 60_000): Buffer[] {
  const header = jumbf.subarray(0, 8);
  const segments: Buffer[] = [
    app11(Buffer.concat([jpegXtHeader(en, 1), jumbf.subarray(0, chunkSize)])),
  ];
  for (let offset = chunkSize, z = 2; offset < jumbf.length; offset += chunkSize, z += 1) {
    segments.push(
      app11(
        Buffer.concat([jpegXtHeader(en, z), header, jumbf.subarray(offset, offset + chunkSize)]),
      ),
    );
  }
  return segments;
}

/** A valid JPEG with the given raw segments inserted right after SOI. */
export function jpegWithSegments(segments: Buffer[]): Buffer {
  const jpeg = makeJpeg();
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

/** Raw APP11 segments of a JPEG and the byte offset just past the last one. */
export function jpegApp11(jpeg: Buffer): { segments: Buffer[]; end: number } {
  const segments: Buffer[] = [];
  let pos = 2;
  let end = 2;
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff && jpeg[pos + 1] !== 0xda) {
    const length = jpeg.readUInt16BE(pos + 2);
    if (jpeg[pos + 1] === 0xeb) {
      segments.push(jpeg.subarray(pos, pos + 2 + length));
      end = pos + 2 + length;
    }
    pos += 2 + length;
  }
  return { segments, end };
}

// ---- certificates ---------------------------------------------------------

export interface TestChain {
  certPath: string;
  keyPath: string;
  leaf: X509Certificate;
}

/**
 * A throwaway ES256 chain with the C2PA claim-signing leaf profile (as
 * scripts/gen-dev-certs.sh) but caller-chosen subjects, e.g. a leaf whose
 * subject O differs from its issuer's. Works with OpenSSL 3 and LibreSSL.
 */
export function generateChain(dir: string, subjects: { root: string; leaf: string }): TestChain {
  mkdirSync(dir, { recursive: true });
  const run = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  writeFileSync(
    join(dir, "root.cnf"),
    "[req]\ndistinguished_name = dn\nx509_extensions = ext\n[dn]\n[ext]\n" +
      "basicConstraints = critical, CA:TRUE\nkeyUsage = critical, keyCertSign, cRLSign\n" +
      "subjectKeyIdentifier = hash\n",
  );
  writeFileSync(
    join(dir, "leaf.cnf"),
    "[req]\ndistinguished_name = dn\n[dn]\n[ext]\nbasicConstraints = critical, CA:FALSE\n" +
      "keyUsage = critical, digitalSignature\nextendedKeyUsage = emailProtection\n" +
      "subjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid:always\n",
  );
  run("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "root.key");
  run(
    "req",
    "-new",
    "-x509",
    "-key",
    "root.key",
    "-out",
    "root.crt",
    "-days",
    "30",
    "-sha256",
    "-subj",
    subjects.root,
    "-config",
    "root.cnf",
  );
  run("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "leaf.key");
  run(
    "req",
    "-new",
    "-key",
    "leaf.key",
    "-out",
    "leaf.csr",
    "-subj",
    subjects.leaf,
    "-config",
    "leaf.cnf",
  );
  run(
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "root.crt",
    "-CAkey",
    "root.key",
    "-CAcreateserial",
    "-out",
    "leaf.crt",
    "-days",
    "30",
    "-sha256",
    "-extfile",
    "leaf.cnf",
    "-extensions",
    "ext",
  );
  run("pkcs8", "-topk8", "-nocrypt", "-in", "leaf.key", "-out", "key.pem");
  const leafPem = readFileSync(join(dir, "leaf.crt"));
  writeFileSync(
    join(dir, "chain.pem"),
    Buffer.concat([leafPem, readFileSync(join(dir, "root.crt"))]),
  );
  return {
    certPath: join(dir, "chain.pem"),
    keyPath: join(dir, "key.pem"),
    leaf: new X509Certificate(leafPem),
  };
}

/** The signer as c2pa-rs reports it: decimal serial, last subject O as `issuer`. */
export function reportedSigner(leaf: X509Certificate): {
  issuer: string;
  cert_serial_number: string;
} {
  const subjectO: unknown = leaf.toLegacyObject().subject?.O;
  const lastO = Array.isArray(subjectO) ? subjectO.at(-1) : subjectO;
  return {
    issuer: String(lastO),
    cert_serial_number: BigInt(`0x${leaf.serialNumber}`).toString(),
  };
}
