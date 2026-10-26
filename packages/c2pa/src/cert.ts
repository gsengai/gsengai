// SPDX-License-Identifier: Apache-2.0
// Signing-certificate fingerprints (ADR-0039): the SHA-256 of the leaf
// certificate's DER, as lowercase hex — what evidence records carry as
// `signer_cert_sha256` and what readManifest compares against the bundled
// dev certificate. Public certificate metadata, never key material.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SignatureInfoJson } from "./backend";

export const DEV_CERT_PATH = fileURLToPath(
  new URL("../dev-certs/dev-cert-chain.pem", import.meta.url),
);
export const DEV_KEY_PATH = fileURLToPath(
  new URL("../dev-certs/dev-private-key.pem", import.meta.url),
);

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u;

/** SHA-256 fingerprint of one certificate (PEM or DER), lowercase hex without separators. */
export function certificateSha256(certificate: string | Buffer): string {
  return new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toLowerCase();
}

/** Fingerprint of the leaf — the first certificate — of a PEM chain. */
export function leafCertificateSha256(pemChain: string | Buffer, source: string): string {
  const leaf = PEM_CERTIFICATE.exec(pemChain.toString())?.[0];
  if (leaf === undefined) {
    throw new TypeError(`gsengai: ${source} contains no PEM certificate`);
  }
  return certificateSha256(leaf);
}

let devCertificateSha256Cache: string | undefined;

/**
 * Fingerprint of the bundled dev leaf certificate, computed from the shipped
 * chain at runtime (never hardcoded), so regenerating the dev certs cannot
 * silently break dev-cert detection.
 */
export function devCertificateSha256(): string {
  devCertificateSha256Cache ??= leafCertificateSha256(
    readFileSync(DEV_CERT_PATH),
    "the bundled dev certificate chain",
  );
  return devCertificateSha256Cache;
}

/**
 * Whether `certificate` is the signer the backend reported for the signature
 * it validated (ADR-0040): same serial and same organization, compared the way
 * c2pa-rs produces them — serial in decimal, organization as the last O of
 * the certificate's subject (raw value, not the RFC 2253-escaped DN string).
 * A report without either field matches nothing.
 */
export function isReportedSigner(
  certificate: X509Certificate,
  reported: SignatureInfoJson | null | undefined,
): boolean {
  const serial = reported?.cert_serial_number;
  const organization = reported?.issuer;
  if (typeof serial !== "string" || typeof organization !== "string") {
    return false;
  }
  const subjectO: unknown = certificate.toLegacyObject().subject?.O;
  const lastO = Array.isArray(subjectO) ? subjectO.at(-1) : subjectO;
  return BigInt(`0x${certificate.serialNumber}`).toString() === serial && lastO === organization;
}
