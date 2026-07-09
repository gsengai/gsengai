// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("shipped stylesheet (ADR-0022)", () => {
  it("disclosure.css ships with the package (files + exports)", () => {
    expect(existsSync(join(PKG_DIR, "disclosure.css"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
    expect(pkg.files).toContain("disclosure.css");
    expect(pkg.exports["./disclosure.css"]).toBe("./disclosure.css");
    // Zero runtime deps (ADR-0022); React is a peer, not a dependency.
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies).toEqual({ react: ">=18" });
  });

  it("covers every class the components emit", () => {
    const css = readFileSync(join(PKG_DIR, "disclosure.css"), "utf8");
    for (const cls of [
      ".gsengai-disclosure",
      ".gsengai-interaction-notice",
      ".gsengai-ai-badge",
      ".gsengai-synthetic-label",
      ".gsengai-icon",
      ".gsengai-disclosure-text",
    ]) {
      expect(css, `stylesheet lacks ${cls}`).toContain(cls);
    }
  });

  it("is referenced by the HTML-entry docs", () => {
    const doc = readFileSync(join(REPO_ROOT, "docs", "DISCLOSURE.md"), "utf8");
    expect(doc).toContain("@gsengai/disclosure/disclosure.css");
  });
});
