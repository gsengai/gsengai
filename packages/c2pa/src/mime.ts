// SPDX-License-Identifier: Apache-2.0

export type ImageMime = "image/png" | "image/jpeg";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Detect the image format from magic bytes. Only PNG and JPEG are supported in
 * the MVP (PRD B1); anything else — including corrupt or truncated data — throws.
 */
export function detectImageMime(bytes: Uint8Array, what: string): ImageMime {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 8));
  if (head.length >= 8 && head.equals(PNG_MAGIC)) {
    return "image/png";
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  throw new TypeError(
    `gsengai: ${what} is not a PNG or JPEG image (unrecognized magic bytes). ` +
      "Only PNG and JPEG are supported in the MVP.",
  );
}
