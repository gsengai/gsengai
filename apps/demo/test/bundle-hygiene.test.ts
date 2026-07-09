// SPDX-License-Identifier: Apache-2.0
// No secret and no server-only code can reach the client bundle. The demo is
// keyless by design: nothing in it may even read process.env. Client modules
// (the "use client" import closure) must not touch Node built-ins or the
// server packages. When a production build exists (.next/static after
// `pnpm build`), its chunks are swept for key material too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DEMO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9]{20,}/u, "OpenAI-style API key"],
  [/OPENAI_API_KEY|ANTHROPIC_API_KEY/u, "provider key env var"],
  [/BEGIN (?:RSA |EC )?PRIVATE KEY/u, "PEM private key"],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

// Shipped demo source (the test dir itself names the patterns it hunts).
const sourceFiles = ["app", "components", "lib"]
  .flatMap((dir) => walk(join(DEMO_ROOT, dir)))
  .concat([join(DEMO_ROOT, "next.config.ts"), join(DEMO_ROOT, "package.json")])
  .filter((f) => /\.(?:ts|tsx|css|json)$/u.test(f));

/** Local import closure of every `"use client"` module — what webpack ships to browsers. */
function clientModules(): string[] {
  const roots = sourceFiles.filter(
    (f) => /\.tsx?$/u.test(f) && /^\s*(?:\/\/.*\n)*\s*"use client";/u.test(readFileSync(f, "utf8")),
  );
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined) {
      break;
    }
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/gu)) {
      const specifier = match[1];
      if (specifier === undefined) {
        continue;
      }
      for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`]) {
        const resolved = join(file, "..", candidate);
        if (existsSync(resolved) && !seen.has(resolved)) {
          seen.add(resolved);
          queue.push(resolved);
        }
      }
    }
  }
  return [...seen];
}

describe("no secrets / no server code toward the client", () => {
  it("the demo is keyless: no source file reads process.env", () => {
    for (const file of sourceFiles) {
      expect(readFileSync(file, "utf8").includes("process.env"), `process.env in ${file}`).toBe(
        false,
      );
    }
  });

  it("no source file contains key-like material", () => {
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      for (const [pattern, label] of SECRET_PATTERNS) {
        expect(pattern.test(content), `${label} in ${file}`).toBe(false);
      }
    }
  });

  it("client modules never import Node built-ins or the server packages (types excepted)", () => {
    const modules = clientModules();
    expect(modules.length).toBeGreaterThanOrEqual(3); // TextFlow, ImageFlow, their lib imports
    for (const file of modules) {
      const source = readFileSync(file, "utf8");
      expect(/from\s+"node:/u.test(source), `node: import in client module ${file}`).toBe(false);
      expect(
        /import\s+(?!type\b)[^;]*from\s+"@gsengai\//u.test(source),
        `runtime @gsengai/* import in client module ${file}`,
      ).toBe(false);
      for (const banned of ["better-sqlite3", "@contentauth/c2pa-node"]) {
        expect(source.includes(banned), `${banned} referenced in client module ${file}`).toBe(
          false,
        );
      }
    }
  });

  it("built client chunks (when present) carry no key material and no server packages", () => {
    const staticDir = join(DEMO_ROOT, ".next", "static");
    if (!existsSync(staticDir)) {
      // `pnpm build` has not run in this checkout; the source-level sweeps
      // above still hold. After a build, this re-runs against the real bundle.
      return;
    }
    const devKey = readFileSync(
      join(REPO_ROOT, "packages", "c2pa", "dev-certs", "dev-private-key.pem"),
      "utf8",
    )
      .split("\n")[1]
      ?.trim();
    const chunks: string[] = [];
    const collect = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          collect(full);
        } else {
          chunks.push(full);
        }
      }
    };
    collect(staticDir);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const content = readFileSync(chunk, "utf8");
      for (const [pattern, label] of SECRET_PATTERNS) {
        expect(pattern.test(content), `${label} in client chunk ${chunk}`).toBe(false);
      }
      if (devKey !== undefined && devKey.length > 0) {
        expect(content.includes(devKey), `dev private key in client chunk ${chunk}`).toBe(false);
      }
      expect(content.includes("better-sqlite3"), `better-sqlite3 in client chunk ${chunk}`).toBe(
        false,
      );
    }
  });
});
