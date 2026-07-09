// SPDX-License-Identifier: Apache-2.0
// Positioning law: user-facing copy says "supports compliance
// with …" — never a compliance promise. This lint also pins the existence and
// completeness of the capture-coverage doc.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const FORBIDDEN_PHRASES = ["makes you compliant", "guarantees compliance", "ensures compliance"];

function userFacingMarkdown(): string[] {
  const files: string[] = [join(REPO_ROOT, "README.md"), join(REPO_ROOT, "QUICKSTART.md")];
  for (const entry of readdirSync(join(REPO_ROOT, "docs"))) {
    if (entry.endsWith(".md")) {
      files.push(join(REPO_ROOT, "docs", entry));
    }
  }
  // package-level READMEs, including dev-certs
  const packagesDir = join(REPO_ROOT, "packages");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") {
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.toLowerCase().startsWith("readme") && entry.endsWith(".md")) {
        files.push(full);
      }
    }
  };
  walk(packagesDir);
  return files.filter((f) => existsSync(f));
}

describe("positioning lint", () => {
  it("no user-facing markdown promises compliance", () => {
    const files = userFacingMarkdown();
    expect(files.length).toBeGreaterThanOrEqual(4); // README, QUICKSTART, docs/*, dev-certs README
    for (const file of files) {
      const content = readFileSync(file, "utf8").toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(content.includes(phrase), `"${phrase}" found in ${file}`).toBe(false);
      }
    }
  });

  it("the capture coverage doc exists and names every known gap", () => {
    const docPath = join(REPO_ROOT, "docs", "capture-coverage.md");
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, "utf8");
    // one record per text-bearing choice at n > 1
    expect(doc).toContain("n > 1");
    expect(doc).toMatch(/per text-bearing choice/i);
    // the Stream.tee() bypass
    expect(doc).toContain("tee()");
    expect(doc).toContain("toReadableStream()");
    // derived promises without APIPromise helpers on strict/streaming paths
    expect(doc).toContain(".withResponse()");
    expect(doc).toMatch(/derived promise/i);
    // MessageStream observed via listeners, never proxied
    expect(doc).toContain("MessageStream");
    expect(doc).toMatch(/never proxied|never be proxied/i);
    // fail-open lost-record counter
    expect(doc).toContain("getLostRecordCount()");
    // and it is linked prominently from the README
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain("docs/capture-coverage.md");
  });
});
