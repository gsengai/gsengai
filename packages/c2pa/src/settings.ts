// SPDX-License-Identifier: Apache-2.0

/**
 * Offline discipline: every Reader/Builder gets explicit
 * settings so no OCSP or remote-manifest fetch can occur at sign or read time,
 * and no TSA URL is ever configured. Trust evaluation stays local: it runs
 * against configured anchors only (none by default), which is what makes the
 * dev-cert `signingCredential.untrusted` status honest and reproducible.
 *
 * Keys follow the c2pa-rs settings schema bundled with @contentauth/c2pa-node
 * (c2pa-rs 0.91.3 for 0.9.10). c2pa-rs ignores unknown keys silently, so a
 * renamed key would quietly fall back to its default — and the default for
 * `remote_manifest_fetch` is `true`. Re-check these keys on every c2pa-node
 * upgrade (ADR-0042).
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
  // c2pa-rs 0.91 adds a claim thumbnail by default; the c2patool backend
  // disables it too, so both backends keep producing equivalent manifests.
  builder: { thumbnail: { enabled: false } },
} as const;

/** Settings for `readManifest`: full local validation including trust, still no fetches. */
export const OFFLINE_VALIDATE_SETTINGS = {
  verify: {
    verify_after_reading: true,
    verify_trust: true,
    ocsp_fetch: false,
    remote_manifest_fetch: false,
  },
} as const;
