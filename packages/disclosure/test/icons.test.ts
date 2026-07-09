// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_SVGS } from "../src/icon-svgs.js";

const ICONS_DIR = fileURLToPath(new URL("../icons", import.meta.url));

const VARIANTS = ["basic", "generated", "modified"] as const;
const TREATMENTS = ["black", "black-50", "white", "white-50"] as const;

describe("bundled official EU icon assets (ADR-0020)", () => {
  it("ships all 12 SVGs: 3 provenance variants × 4 colour treatments", () => {
    for (const variant of VARIANTS) {
      for (const treatment of TREATMENTS) {
        const file = join(ICONS_DIR, `eu-ai-label-${variant}-${treatment}.svg`);
        expect(existsSync(file), `missing ${file}`).toBe(true);
        expect(readFileSync(file, "utf8")).toContain("<svg");
      }
    }
  });

  it("PROVENANCE.md records source, publication date, and the free-use terms", () => {
    const path = join(ICONS_DIR, "PROVENANCE.md");
    expect(existsSync(path)).toBe(true);
    const doc = readFileSync(path, "utf8");
    expect(doc).toContain("2026-06-10");
    expect(doc).toContain(
      "digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content",
    );
    expect(doc).toMatch(/use freely, without the need for attribution/u);
    // The honest caveats (ADR-0020) live here too.
    expect(doc).toMatch(/does .*not by itself establish compliance/iu);
    expect(doc).toMatch(/non-signatory/iu);
  });

  it("the inlined icon module carries the same vector paths as the asset files", () => {
    for (const variant of VARIANTS) {
      for (const treatment of TREATMENTS) {
        const file = join(ICONS_DIR, `eu-ai-label-${variant}-${treatment}.svg`);
        const paths = [...readFileSync(file, "utf8").matchAll(/ d="([^"]+)"/gu)].map((m) =>
          (m[1] as string).replace(/\s+/gu, " ").trim(),
        );
        expect(paths.length).toBeGreaterThan(0);
        const inlined = ICON_SVGS[variant][treatment];
        for (const d of paths) {
          expect(inlined, `${variant}/${treatment} lost a path`).toContain(d);
        }
      }
    }
  });
});
