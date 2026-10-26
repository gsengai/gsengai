// SPDX-License-Identifier: Apache-2.0
// Extracts the signing (leaf) certificate of a manifest from the embedded C2PA
// manifest store (ADR-0039). Neither backend exposes the certificate itself —
// the c2pa-rs manifest JSON carries only issuer/common name/serial — so the
// store is walked directly: container (PNG caBX chunk or JPEG APP11 JUMBF
// segments) → JUMBF superbox "c2pa" → manifest superbox → "c2pa.signature" →
// COSE_Sign1 → x5chain[0]. Read-only, offline, and defensive: any structure it
// does not understand yields null rather than a guess.
import type { ImageMime } from "./mime";

const PNG_SIGNATURE_LENGTH = 8;
const MAX_CBOR_DEPTH = 32;
const COSE_SIGN1_TAG = 18;
const COSE_HEADER_X5CHAIN = 33;

interface JumbfBox {
  type: string;
  /** Box payload, header excluded. */
  data: Buffer;
}

/** Iterate ISO BMFF-style boxes (LBox, TBox, optional XLBox) laid end to end. */
function* boxes(data: Buffer): Generator<JumbfBox> {
  let pos = 0;
  while (pos + 8 <= data.length) {
    let size = data.readUInt32BE(pos);
    const type = data.toString("latin1", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > data.length) {
        return;
      }
      size = Number(data.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = data.length - pos;
    }
    if (size < header || pos + size > data.length) {
      return;
    }
    yield { type, data: data.subarray(pos + header, pos + size) };
    pos += size;
  }
}

/** A JUMBF superbox's label (from its jumd description box) and its content boxes. */
function superbox(box: JumbfBox): { label: string | null; children: JumbfBox[] } | null {
  if (box.type !== "jumb") {
    return null;
  }
  const [description, ...children] = [...boxes(box.data)];
  if (description?.type !== "jumd" || description.data.length < 17) {
    return null;
  }
  const toggles = description.data[16] ?? 0;
  let label: string | null = null;
  if ((toggles & 0x02) !== 0) {
    const end = description.data.indexOf(0, 17);
    label = description.data.toString("utf8", 17, end === -1 ? undefined : end);
  }
  return { label, children };
}

function pngManifestStore(bytes: Buffer): Buffer | null {
  let pos = PNG_SIGNATURE_LENGTH;
  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    if (type === "caBX") {
      return bytes.subarray(pos + 8, Math.min(pos + 8 + length, bytes.length));
    }
    if (type === "IEND") {
      return null;
    }
    pos += 12 + length;
  }
  return null;
}

/**
 * JPEG XT box reassembly: each APP11 segment carries CI "JP", box instance En,
 * sequence Z, then box bytes; continuation segments (Z > 1) repeat the box's
 * LBox/TBox (and XLBox), which are dropped when concatenating.
 */
function jpegManifestStore(bytes: Buffer): Buffer | null {
  const instances = new Map<number, { z: number; payload: Buffer }[]>();
  let pos = 2; // after SOI
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) {
      break; // EOI / start of scan: metadata segments are all behind us
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0xff) {
      pos += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = bytes.readUInt16BE(pos + 2);
    const segment = bytes.subarray(pos + 4, Math.min(pos + 2 + length, bytes.length));
    if (marker === 0xeb && segment.length >= 8 && segment.toString("latin1", 0, 2) === "JP") {
      const en = segment.readUInt16BE(2);
      const z = segment.readUInt32BE(4);
      const packets = instances.get(en) ?? [];
      packets.push({ z, payload: segment.subarray(8) });
      instances.set(en, packets);
    }
    pos += 2 + length;
  }
  for (const packets of instances.values()) {
    packets.sort((a, b) => a.z - b.z);
    const [first, ...rest] = packets;
    if (first === undefined || first.payload.length < 8) {
      continue;
    }
    const headerLength = first.payload.readUInt32BE(0) === 1 ? 16 : 8;
    const store = Buffer.concat([
      first.payload,
      ...rest.map((packet) => packet.payload.subarray(headerLength)),
    ]);
    const [box] = boxes(store);
    if (box !== undefined && superbox(box)?.label === "c2pa") {
      return store;
    }
  }
  return null;
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

/** Minimal CBOR (RFC 8949) decoder for COSE headers; throws on anything malformed. */
function decodeCbor(data: Buffer): Cbor {
  let pos = 0;
  const need = (n: number): void => {
    if (pos + n > data.length) {
      throw new RangeError("truncated CBOR");
    }
  };
  const argument = (info: number): number | null => {
    if (info < 24) {
      return info;
    }
    const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (width === undefined) {
      if (info === 31) {
        return null; // indefinite length
      }
      throw new RangeError("reserved CBOR additional info");
    }
    need(width);
    const value = width === 8 ? Number(data.readBigUInt64BE(pos)) : data.readUIntBE(pos, width);
    pos += width;
    return value;
  };
  /** Consumes the "break" stop code that ends an indefinite-length item. */
  const isBreak = (): boolean => {
    if (data[pos] !== 0xff) {
      return false;
    }
    pos += 1;
    return true;
  };
  const item = (depth: number): Cbor => {
    if (depth > MAX_CBOR_DEPTH) {
      throw new RangeError("CBOR nested too deeply");
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
      const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[info] ?? 0;
      need(width);
      pos += width; // simple values and floats carry nothing COSE headers need here
      return undefined;
    }
    const n = argument(info);
    switch (major) {
      case 0:
        return n ?? 0;
      case 1:
        return -1 - (n ?? 0);
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
              throw new RangeError("malformed indefinite-length CBOR string");
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
        while (n === null ? !isBreak() : map.size < n) {
          map.set(item(depth + 1), item(depth + 1));
        }
        return map;
      }
      default:
        return { tag: n ?? 0, value: item(depth + 1) };
    }
  };
  return item(0);
}

/** x5chain[0] from a COSE_Sign1 (tagged or untagged): protected header first, then unprotected. */
function coseLeafCertificate(cose: Cbor): Buffer | null {
  const sign1 =
    cose !== null && typeof cose === "object" && "tag" in cose && cose.tag === COSE_SIGN1_TAG
      ? cose.value
      : cose;
  if (!Array.isArray(sign1) || sign1.length !== 4) {
    return null;
  }
  const [protectedBytes, unprotected] = sign1;
  const headers: Cbor[] = [
    Buffer.isBuffer(protectedBytes) && protectedBytes.length > 0
      ? decodeCbor(protectedBytes)
      : null,
    unprotected,
  ];
  for (const header of headers) {
    if (header instanceof Map) {
      const x5chain = header.get(COSE_HEADER_X5CHAIN);
      const leaf = Array.isArray(x5chain) ? x5chain[0] : x5chain;
      if (Buffer.isBuffer(leaf)) {
        return leaf;
      }
    }
  }
  return null;
}

/**
 * DER bytes of the leaf certificate that signed the manifest labelled
 * `manifestLabel`, or null when the asset carries no embedded store, the
 * manifest is absent, or its signature box cannot be parsed.
 */
export function manifestSigningCertificate(
  bytes: Buffer,
  mimeType: ImageMime,
  manifestLabel: string,
): Buffer | null {
  try {
    const store = mimeType === "image/png" ? pngManifestStore(bytes) : jpegManifestStore(bytes);
    const [storeBox] = store === null ? [] : boxes(store);
    const manifests = storeBox === undefined ? null : superbox(storeBox);
    if (manifests?.label !== "c2pa") {
      return null;
    }
    const manifest = manifests.children
      .map(superbox)
      .find((candidate) => candidate?.label === manifestLabel);
    const signatureBox = manifest?.children
      .map(superbox)
      .find((candidate) => candidate?.label === "c2pa.signature");
    const cbor = signatureBox?.children.find((child) => child.type === "cbor");
    return cbor === undefined ? null : coseLeafCertificate(decodeCbor(cbor.data));
  } catch {
    return null;
  }
}
