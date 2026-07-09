// SPDX-License-Identifier: Apache-2.0
// Positioning lint over the generated audit artifacts. The other
// lints sweep the repo's markdown files; this one covers the *generated* audit
// artifacts: the report Markdown template, the CSV surface, and the CLI copy —
// and pins the §9 limits block verbatim inside the report template.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceStore, runAuditCli } from "@gsengai/core";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

const FORBIDDEN_PHRASES = ["makes you compliant", "guarantees compliance", "ensures compliance"];

function expectClean(content: string, where: string): void {
  const lower = content.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(lower.includes(phrase), `"${phrase}" found in ${where}`).toBe(false);
  }
}

const dir = mkdtempSync(join(tmpdir(), "gsengai-positioning-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("positioning lint — audit export extension", () => {
  it("the generated report template never promises compliance and carries §9 verbatim", () => {
    const store = createEvidenceStore({ path: join(dir, "lint.db") });
    store.append({ modality: "text", model: "m", systemId: "s", outputText: "lint sample" });
    const seeded = store.buildAuditReport().markdown;
    store.close();
    const empty = createEvidenceStore({ path: join(dir, "lint-empty.db") });
    const blank = empty.buildAuditReport().markdown;
    empty.close();

    for (const [markdown, label] of [
      [seeded, "report (seeded store)"],
      [blank, "report (empty store)"],
    ] as const) {
      expectClean(markdown, label);
      // The §9 block, verbatim anchor lines (never paraphrased, never improvised).
      expect(markdown).toContain("> **What this does NOT do**");
      expect(markdown).toContain(
        "> - It does not make you compliant. It supports compliance with EU AI Act Article 50 and California SB 942; compliance depends on your system, your deployment context, and your processes.",
      );
      expect(markdown).toContain(
        "> - It cannot prevent downstream metadata stripping — manifests can be removed by re-encoding, screenshots, or platform uploads. That is exactly why the logging layer exists.",
      );
      expect(markdown).toContain(
        "> - It is not legal advice. Consult qualified counsel about your obligations.",
      );
    }
  });

  it("the CLI usage/help copy never promises compliance", async () => {
    const logs: string[] = [];
    await runAuditCli(["--help"], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
    expect(logs.length).toBeGreaterThan(0);
    expectClean(logs.join("\n"), "gsengai-audit --help");
  });

  it("README and QUICKSTART document the audit export", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain("audit report");
    expect(readme).toContain("CSV");
    expectClean(readme, "README.md");

    const quickstart = readFileSync(join(REPO_ROOT, "QUICKSTART.md"), "utf8");
    expect(quickstart).toContain("gsengai-audit");
    expect(quickstart).toMatch(/render(ing)? the .*Markdown to PDF/i);
    expectClean(quickstart, "QUICKSTART.md");
  });
});
