// SPDX-License-Identifier: Apache-2.0
// Isolated file: the one-time warning is module state, and vitest's per-file
// process isolation guarantees a fresh module here.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImageSigner } from "@gsengai/c2pa";
import { createEvidenceStore } from "@gsengai/core";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dev-cert default warning (ADR-0016)", () => {
  it("warns exactly once when the bundled dev certs are used, and not at all with explicit certs", () => {
    const dir = mkdtempSync(join(tmpdir(), "gsengai-warn-"));
    const store = createEvidenceStore({ path: join(dir, "e.db") });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createImageSigner({ store, systemId: "s1" });
      createImageSigner({ store, systemId: "s2" });
      const devCertWarnings = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes("DEVELOPMENT certificates"),
      );
      expect(devCertWarnings).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
