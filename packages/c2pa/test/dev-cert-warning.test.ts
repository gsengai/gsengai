// SPDX-License-Identifier: Apache-2.0
// Isolated file: the one-time warning is module state, and vitest's per-file
// process isolation guarantees a fresh module here.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createImageSigner } from "@gsengai/c2pa";
import { createEvidenceStore } from "@gsengai/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const DEV_CERT_FILE = fileURLToPath(new URL("../dev-certs/dev-cert-chain.pem", import.meta.url));
const DEV_KEY_FILE = fileURLToPath(new URL("../dev-certs/dev-private-key.pem", import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dev-cert opt-in warning (ADR-0016, ADR-0038)", () => {
  it("warns exactly once when devCertificates: true is passed — never for explicit certs or rejected configs", () => {
    const dir = mkdtempSync(join(tmpdir(), "gsengai-warn-"));
    const store = createEvidenceStore({ path: join(dir, "e.db") });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const devCertWarnings = () =>
      warnSpy.mock.calls.filter((c) => String(c[0]).includes("DEVELOPMENT certificates"));
    try {
      // Rejected configurations throw before any warning.
      expect(() => createImageSigner({ store, systemId: "s0" })).toThrow();
      expect(() =>
        createImageSigner({
          store,
          systemId: "s0",
          devCertificates: true,
          certPath: DEV_CERT_FILE,
        }),
      ).toThrow();
      // Explicit certificate paths are the caller's own choice: no warning.
      createImageSigner({ store, systemId: "s0", certPath: DEV_CERT_FILE, keyPath: DEV_KEY_FILE });
      expect(devCertWarnings()).toHaveLength(0);

      createImageSigner({ store, systemId: "s1", devCertificates: true });
      createImageSigner({ store, systemId: "s2", devCertificates: true });
      expect(devCertWarnings()).toHaveLength(1);
      const message = String(devCertWarnings()[0]?.[0]);
      expect(message).toContain("UNTRUSTED");
      expect(message).toContain("docs/CERTIFICATES.md");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
