// SPDX-License-Identifier: Apache-2.0
// Backend selection (ADR-0035, ADR-0042). Because the c2patool fallback is
// automatic, a native binary that stops loading would go unnoticed — every
// other test would still pass on c2patool. CI therefore declares which backend
// each test run must use (GSENGAI_EXPECT_BACKEND), and this test fails on a
// silent fallback.
import { afterEach, describe, expect, it } from "vitest";
import { resolveBackend } from "../src/backend";

const expected = process.env.GSENGAI_EXPECT_BACKEND;
const forcedBefore = process.env.GSENGAI_C2PA_BACKEND;

afterEach(() => {
  if (forcedBefore === undefined) {
    delete process.env.GSENGAI_C2PA_BACKEND;
  } else {
    process.env.GSENGAI_C2PA_BACKEND = forcedBefore;
  }
});

describe("C2PA backend selection", () => {
  it("resolves the backend this run expects — no silent native-to-c2patool fallback", async () => {
    const backend = await resolveBackend();
    expect(["native", "c2patool"]).toContain(backend.name);
    if (expected !== undefined) {
      expect(backend.name).toBe(expected);
    }
  });

  it("when no backend can run, the error says how to fix it — including blocked install scripts", async () => {
    process.env.GSENGAI_C2PA_BACKEND = "c2patool";
    await expect(resolveBackend("/nonexistent/gsengai-test/c2patool")).rejects.toThrow(
      /no C2PA signing backend available[\s\S]*pnpm approve-builds[\s\S]*trustedDependencies[\s\S]*install c2patool/u,
    );
  });
});
