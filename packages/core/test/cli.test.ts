// SPDX-License-Identifier: Apache-2.0
// gsengai-audit CLI smoke tests, via runAuditCli (the function the bin calls).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceStore, runAuditCli } from "@gsengai/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let dbPath: string;

interface CapturedIo {
  logs: string[];
  errors: string[];
  log(message: string): void;
  error(message: string): void;
}

function captureIo(): CapturedIo {
  return {
    logs: [],
    errors: [],
    log(message: string) {
      this.logs.push(message);
    },
    error(message: string) {
      this.errors.push(message);
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-cli-"));
  dbPath = join(dir, "evidence.db");
  const store = createEvidenceStore({ path: dbPath });
  store.append({ modality: "text", model: "m1", systemId: "sys-a", outputText: "cli alpha" });
  store.append({ modality: "text", model: "m1", systemId: "sys-b", outputText: "cli beta" });
  store.append({
    modality: "image",
    model: "img-model",
    systemId: "sys-a",
    outputBytes: Buffer.from("cli image"),
    manifestRef: "urn:c2pa:cli",
    markingMethods: ["c2pa"],
  });
  store.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("gsengai-audit CLI", () => {
  it("export --format csv writes the expected CSV file", async () => {
    const out = join(dir, "out.csv");
    const io = captureIo();
    const code = await runAuditCli(
      ["export", "--store", dbPath, "--format", "csv", "--out", out],
      io,
    );
    expect(code).toBe(0);
    expect(io.errors).toEqual([]);
    const csv = readFileSync(out, "utf8");
    expect(csv.startsWith("id,ts,modality,model,system_id,")).toBe(true);
    expect(csv.trim().split("\n")).toHaveLength(4); // header + 3 records
    expect(io.logs.join("\n")).toContain("3 record(s)");
  });

  it("export --format report writes the report and states integrity", async () => {
    const out = join(dir, "report.md");
    const io = captureIo();
    const code = await runAuditCli(
      ["export", "--store", dbPath, "--format", "report", "--out", out],
      io,
    );
    expect(code).toBe(0);
    const report = readFileSync(out, "utf8");
    expect(report).toContain("## Integrity");
    expect(report).toContain("**Chain verified** — 3 record(s) checked");
    expect(io.logs.join("\n")).toContain("chain verified");
  });

  it("filter flags narrow the export", async () => {
    const out = join(dir, "filtered.csv");
    const io = captureIo();
    const code = await runAuditCli(
      ["export", "--store", dbPath, "--format", "csv", "--out", out, "--system-id", "sys-b"],
      io,
    );
    expect(code).toBe(0);
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2); // header + 1 record
    expect(lines[1]).toContain("sys-b");
  });

  it("--help prints usage and exits 0", async () => {
    const io = captureIo();
    expect(await runAuditCli(["--help"], io)).toBe(0);
    expect(io.logs.join("\n")).toContain("gsengai-audit export --store");
  });

  it("bad invocations exit 1 without writing anything", async () => {
    const out = join(dir, "never.csv");
    const cases: string[][] = [
      [], // no command
      ["export"], // missing required flags
      ["export", "--store", dbPath, "--format", "xml", "--out", out], // unknown format
      ["export", "--store", join(dir, "missing.db"), "--format", "csv", "--out", out], // no store
      ["export", "--store", dbPath, "--format", "csv", "--out", out, "--modality", "hologram"],
      ["export", "--store", dbPath, "--format", "csv", "--out", out, "--bogus"], // unknown flag
    ];
    for (const argv of cases) {
      const io = captureIo();
      expect(await runAuditCli(argv, io), argv.join(" ")).toBe(1);
      expect(io.errors.length, argv.join(" ")).toBeGreaterThan(0);
    }
    expect(existsSync(out)).toBe(false);
  });
});
