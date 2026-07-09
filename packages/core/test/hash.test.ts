// SPDX-License-Identifier: Apache-2.0

import {
  canonicalJson,
  HASH_VERSION,
  hashPrompt,
  hashText,
  normalizeText,
  sha256Hex,
} from "@gsengai/core";
import { describe, expect, it } from "vitest";

const HEX64 = /^[0-9a-f]{64}$/;

describe("hashText — normalization spec v1 (PRD §5)", () => {
  it("NFC equivalence: composed and decomposed é produce the same normalized hash", () => {
    const composed = hashText("caf\u00e9"); // e-acute as a single code point
    const decomposed = hashText("cafe\u0301"); // e + combining acute accent
    expect(composed.outputHashNormalized).toBe(decomposed.outputHashNormalized);
    // The raw output hashes must differ — the bytes differ.
    expect(composed.outputHash).not.toBe(decomposed.outputHash);
  });

  it("case-fold: differently-cased text produces the same normalized hash", () => {
    const a = hashText("HeLLo WoRLD");
    const b = hashText("hello world");
    expect(a.outputHashNormalized).toBe(b.outputHashNormalized);
    expect(a.outputHash).not.toBe(b.outputHash);
  });

  it("whitespace collapse: every whitespace run becomes a single space", () => {
    const edited = hashText("one \t\t two\n\nthree\r\n four");
    const canonical = hashText("one two three four");
    expect(edited.outputHashNormalized).toBe(canonical.outputHashNormalized);
    expect(normalizeText("one \t\t two\n\nthree\r\n four")).toBe("one two three four");
  });

  it("trim: leading and trailing whitespace is ignored in the normalized hash", () => {
    const padded = hashText("   padded text \n ");
    const bare = hashText("padded text");
    expect(padded.outputHashNormalized).toBe(bare.outputHashNormalized);
  });

  it("empty string hashes deterministically with hashVersion 1", () => {
    const empty = hashText("");
    // sha256 of zero bytes — a fixed, well-known digest.
    expect(empty.outputHash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(empty.outputHashNormalized).toBe(empty.outputHash);
    expect(empty.hashVersion).toBe(1);
    expect(HASH_VERSION).toBe(1);
  });

  it("1 MB input hashes without error and deterministically", () => {
    const big = `${"a".repeat(1024 * 1024)} END`;
    const first = hashText(big);
    const second = hashText(big);
    expect(first.outputHash).toMatch(HEX64);
    expect(first.outputHashNormalized).toMatch(HEX64);
    expect(second).toEqual(first);
  });

  it("is deterministic across calls and matches sha256Hex of the normalized text", () => {
    const raw = "Some Text with NBSP and  runs";
    const hashes = hashText(raw);
    expect(hashText(raw)).toEqual(hashes);
    expect(hashes.outputHash).toBe(sha256Hex(raw));
    expect(hashes.outputHashNormalized).toBe(sha256Hex(normalizeText(raw)));
  });
});

describe("canonicalJson (PRD §4)", () => {
  it("is stable under object key order, recursively", () => {
    const a = { b: 1, a: { d: [1, 2, { z: 0, y: 9 }], c: "x" } };
    const b = { a: { c: "x", d: [1, 2, { y: 9, z: 0 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("is compact, sorts keys, and preserves array order", () => {
    expect(canonicalJson({ b: [3, 1, 2], a: null })).toBe('{"a":null,"b":[3,1,2]}');
  });
});

describe("hashPrompt", () => {
  it("hashes the canonical JSON of messages, independent of key order", () => {
    const messages = [{ role: "user", content: "hi" }];
    const reordered = [{ content: "hi", role: "user" }];
    expect(hashPrompt(messages)).toBe(sha256Hex(canonicalJson(messages)));
    expect(hashPrompt(reordered)).toBe(hashPrompt(messages));
    expect(hashPrompt(messages)).toMatch(HEX64);
  });
});
