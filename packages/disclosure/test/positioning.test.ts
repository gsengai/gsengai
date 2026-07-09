// SPDX-License-Identifier: Apache-2.0
// Extends the positioning lint (packages/c2pa/test/positioning.test.ts, which
// already sweeps README/QUICKSTART/docs/* and package READMEs): covers the disclosure
// package's own markdown, the component user-facing copy, and pins docs/DISCLOSURE.md to
// the Article 50 duty mapping plus the verbatim PRD §9 limits block.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STRINGS } from "@gsengai/disclosure";
import {
  aiGeneratedBadgeHTML,
  interactionNoticeHTML,
  syntheticContentLabelHTML,
} from "@gsengai/disclosure/html";
import { describe, expect, it } from "vitest";

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const FORBIDDEN_PHRASES = ["makes you compliant", "guarantees compliance", "ensures compliance"];

function expectClean(content: string, where: string): void {
  const lower = content.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(lower.includes(phrase), `"${phrase}" found in ${where}`).toBe(false);
  }
}

function markdownFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...markdownFilesUnder(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

describe("positioning lint — disclosure extension", () => {
  it("no markdown in packages/disclosure/** promises compliance", () => {
    const files = markdownFilesUnder(PKG_DIR);
    expect(files.length).toBeGreaterThanOrEqual(1); // at least icons/PROVENANCE.md
    for (const file of files) {
      expectClean(readFileSync(file, "utf8"), file);
    }
  });

  it("no component user-facing copy promises compliance, in any locale", () => {
    for (const [locale, table] of Object.entries(STRINGS)) {
      expectClean(JSON.stringify(table), `STRINGS.${locale}`);
    }
    // And the rendered defaults, which is what users actually ship.
    for (const locale of ["en", "de", "fr"] as const) {
      expectClean(interactionNoticeHTML({ locale }), `interactionNoticeHTML(${locale})`);
      expectClean(aiGeneratedBadgeHTML({ locale }), `aiGeneratedBadgeHTML(${locale})`);
      expectClean(syntheticContentLabelHTML({ locale }), `syntheticContentLabelHTML(${locale})`);
    }
  });

  it("docs/DISCLOSURE.md exists and maps each component to its Article 50 duty", () => {
    const path = join(REPO_ROOT, "docs", "DISCLOSURE.md");
    expect(existsSync(path)).toBe(true);
    const doc = readFileSync(path, "utf8");
    // Component → duty mapping (one row per component).
    expect(doc).toMatch(/AIInteractionNotice[^\n]*50\(1\)/u);
    expect(doc).toMatch(/AIGeneratedBadge[^\n]*50\(4\)/u);
    expect(doc).toMatch(/SyntheticContentLabel[^\n]*50\(4\)/u);
    // Icon caveats (ADR-0020).
    expect(doc).toMatch(/does not by itself establish compliance/iu);
    expect(doc).toMatch(/non-signatory/iu);
    // The PRD §9 limits block, verbatim anchor lines.
    expect(doc).toContain("**What this does NOT do**");
    expect(doc).toContain(
      "It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.",
    );
    expect(doc).toContain(
      "It is not legal advice. Consult qualified counsel about your obligations.",
    );
    expectClean(doc, path);
  });

  it("README lists @gsengai/disclosure in the implemented-packages table", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain("@gsengai/disclosure");
    expect(readme).toContain("docs/DISCLOSURE.md");
  });
});
