// SPDX-License-Identifier: Apache-2.0
// Secret-scanner allowlist guard (ADR-0037). The bundled dev signing key is
// public by design (ADR-0016) and is the only tracked file allowed to carry a
// PEM private key; both scanner configs allowlist exactly that one path. A
// second key anywhere, or a widened allowlist, fails here.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEV_KEY_PATH = "packages/c2pa/dev-certs/dev-private-key.pem";

// Mirrors the header part of gitleaks' private-key rule. `-{5}` keeps a
// literal header out of this file, so the guard never flags itself.
const PEM_PRIVATE_KEY_HEADER = /-{5}BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-{5}/u;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((path) => path.length > 0);
}

function readConfig(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("PEM private keys in tracked files", () => {
  it("only the allowlisted dev key carries a PEM private-key header", () => {
    const files = trackedFiles();
    expect(files).toContain(DEV_KEY_PATH);
    const offenders = files.filter((path) => {
      const full = join(REPO_ROOT, path);
      // Deleted-but-unstaged files have nothing left to leak.
      return existsSync(full) && PEM_PRIVATE_KEY_HEADER.test(readFileSync(full, "latin1"));
    });
    // Positive control: the pattern really does match the dev key.
    expect(offenders).toContain(DEV_KEY_PATH);
    expect(offenders.filter((path) => path !== DEV_KEY_PATH)).toEqual([]);
  });
});

describe("scanner configs allowlist exactly the dev key", () => {
  it(".gitleaks.toml extends the default rules and allowlists only that one path", () => {
    const config = readConfig(".gitleaks.toml");
    expect(config).toMatch(/^\[extend\]\s*\nuseDefault = true$/mu);
    expect(config.match(/^\[\[allowlists\]\]$/gmu)).toHaveLength(1);
    // Nothing else that could suppress findings: no legacy or rule-level
    // allowlists, no custom rules, no commit/regex/stopword exemptions.
    expect(config).not.toMatch(
      /^\[allowlist\]|^\[\[?rules|^\s*(commits|regexes|stopwords|disabledRules|path)\s*=/mu,
    );

    const pathsLines = config.match(/^paths = .*$/gmu) ?? [];
    expect(pathsLines).toEqual([`paths = ['''^${escapeRegExp(DEV_KEY_PATH)}$''']`]);

    // The allowlisted regex matches the dev key and nothing near it.
    const pattern = new RegExp(`^${escapeRegExp(DEV_KEY_PATH)}$`, "u");
    expect(pattern.test(DEV_KEY_PATH)).toBe(true);
    for (const near of [
      "packages/c2pa/dev-certs/dev-cert-chain.pem",
      "packages/c2pa/dev-certs/other-key.pem",
      `${DEV_KEY_PATH}.bak`,
      `vendor/${DEV_KEY_PATH}`,
      "packages/c2pa/dev-certs/dev-private-keyXpem",
    ]) {
      expect(pattern.test(near), near).toBe(false);
    }
  });

  it(".github/secret_scanning.yml ignores only that one literal path", () => {
    const config = readConfig(".github/secret_scanning.yml");
    const topLevelKeys = config.match(/^[^\s-][^:]*:/gmu) ?? [];
    expect(topLevelKeys).toEqual(["paths-ignore:"]);
    const entries = [...config.matchAll(/^\s+-\s+(.+)$/gmu)].map((m) =>
      (m[1] ?? "").trim().replace(/^(["'])(.*)\1$/u, "$2"),
    );
    expect(entries).toEqual([DEV_KEY_PATH]);
    // No filter-pattern special characters: the entry matches exactly one file.
    expect(DEV_KEY_PATH).not.toMatch(/[*?+[\]!]/u);
  });
});
