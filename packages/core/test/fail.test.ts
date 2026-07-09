// SPDX-License-Identifier: Apache-2.0

import {
  type AppendEvidenceInput,
  type EvidenceStore,
  getLostRecordCount,
  resetLostRecordCount,
  safeAppend,
} from "@gsengai/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function throwingStore(): EvidenceStore {
  return {
    append() {
      throw new Error("evidence store unavailable");
    },
  } as unknown as EvidenceStore;
}

const input: AppendEvidenceInput = {
  modality: "text",
  model: "m",
  systemId: "s",
  outputText: "hello",
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetLostRecordCount();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("safeAppend — wrapper failure semantics (PRD A3)", () => {
  it("fail-open (default): returns null, increments the lost-record counter, warns loudly", () => {
    const result = safeAppend(throwingStore(), input);
    expect(result).toBeNull();
    expect(getLostRecordCount()).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("Evidence record LOST");
  });

  it("strict: rethrows and does not count the record as silently lost", () => {
    expect(() => safeAppend(throwingStore(), input, "strict")).toThrow(
      "evidence store unavailable",
    );
    expect(getLostRecordCount()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("covers input-factory failures under the same semantics", () => {
    const store = throwingStore();
    const badFactory = (): AppendEvidenceInput => {
      throw new Error("prompt hashing failed");
    };
    expect(safeAppend(store, badFactory)).toBeNull();
    expect(getLostRecordCount()).toBe(1);
    expect(() => safeAppend(store, badFactory, "strict")).toThrow("prompt hashing failed");
  });
});
