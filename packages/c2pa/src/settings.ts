// SPDX-License-Identifier: Apache-2.0

/**
 * Offline discipline: every Reader/Builder gets explicit
 * settings so no OCSP or remote-manifest fetch can occur at sign or read time,
 * and no TSA URL is ever configured. Trust evaluation stays local: it runs
 * against configured anchors only (none by default), which is what makes the
 * dev-cert `signingCredential.untrusted` status honest and reproducible.
 */

/** Settings for signing and for existence-check reads: no verification, no fetches. */
export const OFFLINE_NO_VERIFY_SETTINGS = {
  verify: {
    verify_after_reading: false,
    verify_after_sign: false,
    verify_trust: false,
    ocsp_fetch: false,
    remote_manifest_fetch: false,
  },
  trust: { verify_trust_list: false },
} as const;

/** Settings for `readManifest`: full local validation including trust, still no fetches. */
export const OFFLINE_VALIDATE_SETTINGS = {
  verify: {
    verify_after_reading: true,
    verify_trust: true,
    ocsp_fetch: false,
    remote_manifest_fetch: false,
  },
  trust: { verify_trust_list: true },
} as const;
