// SPDX-License-Identifier: Apache-2.0
// Shared demo copy. Client-safe (pure strings — no Node built-ins, no @gsengai/*
// imports). Positioning law applies to every string here:
// "supports compliance with …", never a compliance promise; §9 verbatim.
import { BRAND } from "./brand";

/**
 * PRD §9 canonical limits & disclaimer block — verbatim, never paraphrased.
 * Pinned byte-identical to @gsengai/core's PRD_S9_LIMITS by test/positioning.test.ts
 * (this copy exists only so client components never import the server package).
 */
export const S9_LIMITS = `> **What this does NOT do**
>
> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.
> - It does not embed imperceptible watermarks (MVP). It implements the signed-metadata and logging/fingerprinting layers of a multi-layer marking strategy.
> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.
> - It does not detect third-party AI content.
> - It is not legal advice. Consult qualified counsel about your obligations.`;

/** §9 as list items for rendering (derived from the verbatim block, not retyped). */
export const S9_LIMIT_ITEMS = S9_LIMITS.split("\n")
  .filter((line) => line.startsWith("> - "))
  .map((line) => line.slice("> - ".length));

export const TAGLINE = `${BRAND} supports compliance with EU AI Act Article 50 and California SB 942: hash-only text evidence records and C2PA-signed media, in an append-only, tamper-evident evidence log.`;

export const NOT_LEGAL_ADVICE =
  "It is not legal advice. Consult qualified counsel about your obligations.";

/**
 * Dev-cert honesty (ADR-0030): shown in the image flow, in the same view as the
 * verify link, before the user clicks through.
 */
export const DEV_CERT_CAVEAT =
  "This demo signs with development certificates; production uses a trusted CA certificate. " +
  "The verifier will show the issuer as untrusted — that is expected and does not mean the demo is broken.";

export const VERIFY_URL = "https://contentcredentials.org/verify";

/** Privacy architecture, stated plainly in the UI (ADR-0029). */
export const PRIVACY_TEXT_FLOW =
  "Your text is hashed in your browser with Web Crypto — it never leaves this page. " +
  "The server receives hashes only and appends them to a request-scoped, in-memory evidence store that is wiped as soon as the response is sent.";

export const PRIVACY_IMAGE_FLOW =
  "Your image transits to the server for signing (the C2PA signer is a native binary) but is processed in memory and never persisted. " +
  "The evidence store keeps hashes and metadata only and is wiped as soon as the response is sent.";
