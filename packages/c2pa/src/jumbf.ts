// SPDX-License-Identifier: Apache-2.0
// Extracts the signing (leaf) certificate of a manifest from the embedded C2PA
// manifest store (ADR-0039, ADR-0040). Neither backend exposes the certificate
// itself — the c2pa-rs manifest JSON carries only organization, common name,
// and serial — so the store is walked directly: container (PNG caBX chunk or
// JPEG APP11 JUMBF segments) → the one manifest store → the one manifest with
// the requested label → its one "c2pa.signature" box → COSE_Sign1 → x5chain[0].
//
// It must read the signature the backend validated, so it is strict wherever
// a lenient reading could pick a different signature: more than one embedded
// store (c2pa-rs rejects those too), a duplicated label, boxes that do not
// exactly tile their parent, out-of-order JPEG segments, duplicate CBOR map
// keys, trailing bytes, or x5chain in both COSE headers. Every such input
// yields null — never a guess. read.ts then cross-checks the certificate
// against the signer the backend reported.
import type { ImageMime } from "./mime";

const PNG_SIGNATURE_LENGTH = 8;
const MAX_CBOR_DEPTH = 32;
const COSE_SIGN1_TAG = 18;
const COSE_HEADER_X5CHAIN = 33;
/** Manifest-store JUMBF type UUID prefix ("c2pa"), the bytes c2pa-rs keys on. */
const C2PA_STORE_TYPE = Buffer.from("c2pa", "latin1");

/** Thrown for any structure this reader refuses; caught once, at the entry point. */
class Unreadable extends Error {}

interface JumbfBox {
  type: string;
  /** Box payload, header excluded. */
  data: Buffer;
}

interface Superbox {
  label: string | null;
  typeUuid: Buffer;
  children: JumbfBox[];
}

/** ISO BMFF-style boxes (LBox, TBox, optional XLBox) that must tile `data` exactly. */
function boxes(data: Buffer): JumbfBox[] {
  const out: JumbfBox[] = [];
  let pos = 0;
  while (pos < data.length) {
    if (pos + 8 > data.length) {
      throw new Unreadable("truncated box header");
    }
    let size = data.readUInt32BE(pos);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > data.length) {
        throw new Unreadable("truncated 64-bit box length");
      }
      const extended = data.readBigUInt64BE(pos + 8);
      if (extended > BigInt(data.length - pos)) {
        throw new Unreadable("64-bit box length past the end of the data");
      }
      size = Number(extended);
      header = 16;
    } else if (size === 0) {
      size = data.length - pos; // "extends to the end"
    }
    if (size < header || pos + size > data.length) {
      throw new Unreadable("box length out of range");
    }
    out.push({
      type: data.toString("latin1", pos + 4, pos + 8),
      data: data.subarray(pos + header, pos + size),
    });
    pos += size;
  }
  return out;
}

/** The one box that exactly fills `data`. */
function onlyBox(data: Buffer): JumbfBox {
  const all = boxes(data);
  if (all.length !== 1 || all[0] === undefined) {
    throw new Unreadable("expected exactly one box");
  }
  return all[0];
}

/** A JUMBF superbox's description (label, type UUID) and content boxes; null for non-superboxes. */
function superbox(box: JumbfBox): Superbox | null {
  if (box.type !== "jumb") {
    return null;
  }
  const [description, ...children] = boxes(box.data);
  if (description?.type !== "jumd" || description.data.length < 17) {
    throw new Unreadable("superbox without a description box");
  }
  const toggles = description.data[16] ?? 0;
  let label: string | null = null;
  if ((toggles & 0x02) !== 0) {
    const end = description.data.indexOf(0, 17);
    if (end === -1) {
      throw new Unreadable("unterminated superbox label");
    }
    label = description.data.toString("utf8", 17, end);
  }
  return { label, typeUuid: description.data.subarray(0, 16), children };
}

/** The single item of `items` matching `predicate`; zero or several are refused. */
function exactlyOne<T>(items: T[], predicate: (item: T) => boolean, what: string): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Unreadable(`expected exactly one ${what}, found ${matches.length}`);
  }
  return matches[0];
}

/** Every caBX chunk up to IEND. Chunk CRCs are not checked (c2pa-rs does not either). */
function pngStores(bytes: Buffer): Buffer[] {
  const stores: Buffer[] = [];
  let pos = PNG_SIGNATURE_LENGTH;
  while (pos < bytes.length) {
    if (pos + 12 > bytes.length) {
      throw new Unreadable("truncated PNG chunk");
    }
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    if (pos + 12 + length > bytes.length) {
      throw new Unreadable("PNG chunk length past the end of the data");
    }
    if (type === "caBX") {
      stores.push(bytes.subarray(pos + 8, pos + 8 + length));
    }
    if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  return stores;
}

/**
 * JPEG XT boxes from APP11 segments, reassembled the way c2pa-rs does: per box
 * instance En, a Z = 1 segment starts the box and continuations follow in file
 * order with Z = previous + 1, each repeating the box header (dropped here).
 * Repeated, skipped, or reordered segments are refused rather than repaired.
 */
function jpegBoxes(bytes: Buffer): Buffer[] {
  const open = new Map<number, { z: number; header: Buffer; parts: Buffer[] }>();
  let pos = 2; // after SOI
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) {
      break; // EOI / start of scan: every metadata segment is behind us
    }
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2; // standalone marker, no length
      continue;
    }
    const length = bytes.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > bytes.length) {
      throw new Unreadable("JPEG segment length past the end of the data");
    }
    const segment = bytes.subarray(pos + 4, pos + 2 + length);
    // c2pa-rs ignores APP11 segments of 16 bytes or less; so does this reader.
    if (marker === 0xeb && segment.length > 16 && segment.toString("latin1", 0, 2) === "JP") {
      const en = segment.readUInt16BE(2);
      const z = segment.readUInt32BE(4);
      const payload = segment.subarray(8);
      const current = open.get(en);
      if (z === 1) {
        if (current !== undefined) {
          throw new Unreadable("two JPEG XT boxes share one instance number");
        }
        const header = payload.subarray(0, payload.readUInt32BE(0) === 1 ? 16 : 8);
        open.set(en, { z, header, parts: [payload] });
      } else {
        if (current === undefined || z !== current.z + 1) {
          throw new Unreadable("out-of-order JPEG XT continuation segment");
        }
        if (!payload.subarray(0, current.header.length).equals(current.header)) {
          throw new Unreadable("JPEG XT continuation repeats a different box header");
        }
        current.parts.push(payload.subarray(current.header.length));
        current.z = z;
      }
    }
    pos += 2 + length;
  }
  return [...open.values()].map((box) => Buffer.concat(box.parts));
}

/**
 * The one embedded manifest store. JPEG XT boxes count as stores when c2pa-rs
 * would take them for one (description type "c2pa…") or when they are labelled
 * "c2pa"; other JUMBF uses of APP11 are ignored, as c2pa-rs ignores them.
 */
function manifestStore(bytes: Buffer, mimeType: ImageMime): Superbox {
  let candidates: Buffer[];
  if (mimeType === "image/png") {
    candidates = pngStores(bytes);
  } else {
    candidates = jpegBoxes(bytes).filter((box) => {
      if (box.subarray(16, 20).equals(C2PA_STORE_TYPE)) {
        return true;
      }
      try {
        return superbox(onlyBox(box))?.label === "c2pa";
      } catch {
        return false; // not a parseable JUMBF box at all, and not typed as C2PA
      }
    });
  }
  const store = superbox(onlyBox(exactlyOne(candidates, () => true, "embedded manifest store")));
  if (store?.label !== "c2pa") {
    throw new Unreadable("manifest store is not labelled c2pa");
  }
  return store;
}

type Cbor =
  | number
  | bigint
  | string
  | boolean
  | null
  | undefined
  | Buffer
  | Cbor[]
  | Map<Cbor, Cbor>
  | { tag: number; value: Cbor };

const ARGUMENT_WIDTH: Record<number, number> = { 24: 1, 25: 2, 26: 4, 27: 8 };

/**
 * Minimal strict CBOR (RFC 8949) decoder for COSE structures: one complete
 * item, no trailing bytes, no duplicate map keys, bounded nesting. Counts are
 * never preallocated, so a huge declared count costs at most one pass over the
 * actual bytes before it runs out of data.
 */
function decodeCbor(data: Buffer): Cbor {
  let pos = 0;
  const need = (n: number): void => {
    if (pos + n > data.length) {
      throw new Unreadable("truncated CBOR");
    }
  };
  /** Consumes the "break" stop code that ends an indefinite-length item. */
  const isBreak = (): boolean => {
    need(1);
    if (data[pos] !== 0xff) {
      return false;
    }
    pos += 1;
    return true;
  };
  const argument = (info: number, indefiniteAllowed: boolean): number | null => {
    if (info < 24) {
      return info;
    }
    if (info === 31 && indefiniteAllowed) {
      return null;
    }
    const width = ARGUMENT_WIDTH[info];
    if (width === undefined) {
      throw new Unreadable("invalid CBOR additional information");
    }
    need(width);
    const value = width === 8 ? Number(data.readBigUInt64BE(pos)) : data.readUIntBE(pos, width);
    pos += width;
    return value;
  };
  const item = (depth: number): Cbor => {
    if (depth > MAX_CBOR_DEPTH) {
      throw new Unreadable("CBOR nested past the depth limit");
    }
    need(1);
    const initial = data[pos++] ?? 0;
    const major = initial >> 5;
    const info = initial & 0x1f;
    if (major === 7) {
      if (info === 20 || info === 21) {
        return info === 21;
      }
      if (info === 22) {
        return null;
      }
      if (info === 31) {
        throw new Unreadable("unexpected CBOR break");
      }
      const width = ARGUMENT_WIDTH[info] ?? 0;
      need(width);
      pos += width; // other simple values and floats: nothing COSE headers need here
      return undefined;
    }
    const n = argument(info, major >= 2 && major <= 5);
    switch (major) {
      case 0:
        return n as number;
      case 1:
        return -1 - (n as number);
      case 2:
      case 3: {
        let bytes: Buffer;
        if (n === null) {
          const chunks: Buffer[] = [];
          while (!isBreak()) {
            const chunk = item(depth + 1);
            if (typeof chunk === "string") {
              chunks.push(Buffer.from(chunk, "utf8"));
            } else if (Buffer.isBuffer(chunk)) {
              chunks.push(chunk);
            } else {
              throw new Unreadable("malformed indefinite-length CBOR string");
            }
          }
          bytes = Buffer.concat(chunks);
        } else {
          need(n);
          bytes = data.subarray(pos, pos + n);
          pos += n;
        }
        return major === 2 ? bytes : bytes.toString("utf8");
      }
      case 4: {
        const array: Cbor[] = [];
        while (n === null ? !isBreak() : array.length < n) {
          array.push(item(depth + 1));
        }
        return array;
      }
      case 5: {
        const map = new Map<Cbor, Cbor>();
        let entries = 0;
        while (n === null ? !isBreak() : entries < n) {
          const key = item(depth + 1);
          if (map.has(key)) {
            throw new Unreadable("duplicate CBOR map key");
          }
          map.set(key, item(depth + 1));
          entries += 1;
        }
        return map;
      }
      default:
        return { tag: n as number, value: item(depth + 1) };
    }
  };
  const value = item(0);
  if (pos !== data.length) {
    throw new Unreadable("trailing bytes after CBOR item");
  }
  return value;
}

function isTagged(value: Cbor): value is { tag: number; value: Cbor } {
  return value !== null && typeof value === "object" && "tag" in value;
}

/** x5chain[0] from a COSE_Sign1 (tagged or untagged); x5chain must sit in exactly one header. */
function coseLeafCertificate(cose: Cbor): Buffer {
  let sign1 = cose;
  if (isTagged(cose)) {
    if (cose.tag !== COSE_SIGN1_TAG) {
      throw new Unreadable("not a COSE_Sign1");
    }
    sign1 = cose.value;
  }
  if (!Array.isArray(sign1) || sign1.length !== 4) {
    throw new Unreadable("not a COSE_Sign1");
  }
  const [protectedBytes, unprotected] = sign1;
  if (!Buffer.isBuffer(protectedBytes) || !(unprotected instanceof Map)) {
    throw new Unreadable("malformed COSE headers");
  }
  const protectedHeader = protectedBytes.length === 0 ? new Map() : decodeCbor(protectedBytes);
  if (!(protectedHeader instanceof Map)) {
    throw new Unreadable("malformed COSE protected header");
  }
  const x5chain = exactlyOne(
    [protectedHeader, unprotected].filter((header) => header.has(COSE_HEADER_X5CHAIN)),
    () => true,
    "COSE header carrying x5chain",
  ).get(COSE_HEADER_X5CHAIN);
  const leaf = Array.isArray(x5chain) ? x5chain[0] : x5chain;
  if (!Buffer.isBuffer(leaf) || leaf.length === 0) {
    throw new Unreadable("x5chain carries no leaf certificate");
  }
  return leaf;
}

/**
 * DER bytes of the leaf certificate that signed the manifest labelled
 * `manifestLabel`, or null when that cannot be determined unambiguously: no
 * or several embedded stores, a missing or duplicated manifest or signature
 * box, or any structure this reader refuses.
 */
export function manifestSigningCertificate(
  bytes: Buffer,
  mimeType: ImageMime,
  manifestLabel: string,
): Buffer | null {
  try {
    const store = manifestStore(bytes, mimeType);
    const manifests = store.children.map(superbox);
    const manifest = exactlyOne(manifests, (m) => m?.label === manifestLabel, "manifest");
    const parts = (manifest as Superbox).children.map(superbox);
    const signature = exactlyOne(parts, (p) => p?.label === "c2pa.signature", "signature box");
    const cbor = exactlyOne(
      (signature as Superbox).children,
      (child) => child.type === "cbor",
      "CBOR signature payload",
    );
    return coseLeafCertificate(decodeCbor(cbor.data));
  } catch {
    // Unreadable, or a Buffer bounds error on input this reader did not anticipate:
    // either way the certificate cannot be determined, and readManifest must not throw.
    return null;
  }
}
