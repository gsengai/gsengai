// SPDX-License-Identifier: Apache-2.0
// Positioning lint over the
// demo: no banned phrase anywhere in the demo app, §9 verbatim (pinned
// byte-identical to core's constant), and the dev-cert honesty caveat lives in
// the same view as the contentcredentials.org verify link (ADR-0030).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRD_S9_LIMITS } from "@gsengai/core";
import { describe, expect, it } from "vitest";
import { DEV_CERT_CAVEAT, S9_LIMIT_ITEMS, S9_LIMITS, TAGLINE, VERIFY_URL } from "../lib/copy";

const DEMO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const FORBIDDEN_PHRASES = ["makes you compliant", "guarantees compliance", "ensures compliance"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(?:ts|tsx|css|json|md)$/u.test(full)) {
      out.push(full);
    }
  }
  return out;
}

describe("positioning lint — demo extension", () => {
  it("no demo file promises compliance", () => {
    // Shipped demo source and config — the test dir names the banned phrases itself.
    const files = ["app", "components", "lib"]
      .flatMap((dir) => walk(join(DEMO_ROOT, dir)))
      .concat([
        join(DEMO_ROOT, "next.config.ts"),
        join(DEMO_ROOT, "package.json"),
        join(DEMO_ROOT, "DEPLOY.md"),
        join(DEMO_ROOT, "vercel.json"),
      ]);
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      const content = readFileSync(file, "utf8").toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(content.includes(phrase), `"${phrase}" found in ${file}`).toBe(false);
      }
    }
  });

  it("demo copy leads with 'supports compliance with' and stays inside the positioning law", () => {
    expect(TAGLINE).toContain("supports compliance with EU AI Act Article 50");
  });

  it("the demo's §9 block is byte-identical to PRD §9 (never retyped, never paraphrased)", () => {
    expect(S9_LIMITS).toBe(PRD_S9_LIMITS);
    // …and the rendered items are derived from it, including not-legal-advice.
    expect(S9_LIMIT_ITEMS).toHaveLength(5);
    expect(S9_LIMIT_ITEMS.at(-1)).toBe(
      "It is not legal advice. Consult qualified counsel about your obligations.",
    );
  });

  it("the page renders the §9 block via LimitsBlock (visible on the demo page)", () => {
    const page = readFileSync(join(DEMO_ROOT, "app", "page.tsx"), "utf8");
    expect(page).toContain("<LimitsBlock />");
    expect(page).toContain("NOT_LEGAL_ADVICE");
  });

  it("the dev-cert caveat names the untrusted-issuer outcome and sits in the same view as the verify link (ADR-0030)", () => {
    expect(DEV_CERT_CAVEAT).toContain("development certificates");
    expect(DEV_CERT_CAVEAT).toContain("untrusted");
    expect(DEV_CERT_CAVEAT).toContain("expected");
    expect(VERIFY_URL).toBe("https://contentcredentials.org/verify");

    const imageFlow = readFileSync(join(DEMO_ROOT, "components", "ImageFlow.tsx"), "utf8");
    // Same component renders both — and the caveat renders statically, before
    // any result exists (the render test asserts that), so the user reads it
    // before they can click through.
    expect(imageFlow).toContain("DEV_CERT_CAVEAT");
    expect(imageFlow).toContain("VERIFY_URL");
    expect(imageFlow.indexOf("DEV_CERT_CAVEAT}")).toBeLessThan(imageFlow.indexOf("VERIFY_URL}"));
  });
});
