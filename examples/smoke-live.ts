// SPDX-License-Identifier: Apache-2.0
/**
 * Live-API smoke test for the text wrappers, validating wrapper semantics
 * against real APIs (the unit tests use mocks only).
 *
 * OPT-IN AND KEY-GATED. Runs only the paths whose API key is present in the
 * environment; never part of `pnpm test` or CI. Costs a few cents of tokens.
 *
 *   OPENAI_API_KEY=...    enables the OpenAI paths and the AI SDK paths
 *   ANTHROPIC_API_KEY=... enables the Anthropic paths
 *
 * Run: pnpm tsx examples/smoke-live.ts
 *
 * Each path asserts an evidence record landed in a temp store and prints
 * pass/fail. The tee() probe characterizes whether tee'd branches record
 * once, twice, or never (feeds docs/capture-coverage.md).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceStore, type EvidenceStore } from "@gsengai/core";

const PROMPT = "Reply with exactly the word: pong";
const results: { path: string; outcome: string; ok: boolean }[] = [];

function freshStore(dir: string, name: string): EvidenceStore {
  return createEvidenceStore({ path: join(dir, `${name}.db`) });
}

async function run(
  path: string,
  dir: string,
  fn: (store: EvidenceStore) => Promise<string | undefined> | Promise<void>,
): Promise<void> {
  const store = freshStore(dir, path.replace(/[^a-z0-9]+/gi, "-"));
  try {
    const note = await fn(store);
    const count = store.count();
    if (typeof note === "string") {
      results.push({ path, outcome: note, ok: true });
    } else if (count >= 1) {
      results.push({
        path,
        outcome: `recorded (${count} record${count > 1 ? "s" : ""})`,
        ok: true,
      });
    } else {
      results.push({ path, outcome: "NO RECORD WRITTEN", ok: false });
    }
  } catch (err) {
    results.push({ path, outcome: `threw: ${(err as Error).message}`, ok: false });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "gsengai-smoke-live-"));
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) {
    console.log("No OPENAI_API_KEY or ANTHROPIC_API_KEY in env — nothing to smoke. Exiting.");
    return;
  }

  if (openaiKey) {
    const { default: OpenAI } = await import("openai");
    const { withEvidence } = await import("@gsengai/openai");
    const model = process.env.GSENGAI_SMOKE_OPENAI_MODEL ?? "gpt-4o-mini";

    await run("openai chat non-stream", dir, async (store) => {
      const client = withEvidence(new OpenAI(), { store, systemId: "smoke-live" });
      await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: PROMPT }],
      });
    });

    await run("openai chat stream", dir, async (store) => {
      const client = withEvidence(new OpenAI(), { store, systemId: "smoke-live" });
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: PROMPT }],
        stream: true,
      });
      for await (const _chunk of stream) {
        // consume fully
      }
    });

    await run("openai stream.tee() probe", dir, async (store) => {
      const client = withEvidence(new OpenAI(), { store, systemId: "smoke-live" });
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: PROMPT }],
        stream: true,
      });
      const [a, b] = stream.tee();
      for await (const _chunk of a) {
        // consume branch a
      }
      for await (const _chunk of b) {
        // consume branch b
      }
      const count = store.count();
      // Characterization result, not pass/fail: feeds docs/capture-coverage.md.
      return `tee'd branches recorded ${count === 0 ? "never" : count === 1 ? "once" : `${count} times`}`;
    });
  }

  if (anthropicKey) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { withEvidence } = await import("@gsengai/anthropic");
    const model = process.env.GSENGAI_SMOKE_ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

    await run("anthropic messages.create({stream:true})", dir, async (store) => {
      const client = withEvidence(new Anthropic(), { store, systemId: "smoke-live" });
      const stream = await client.messages.create({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: PROMPT }],
        stream: true,
      });
      for await (const _event of stream) {
        // consume fully
      }
    });

    await run("anthropic messages.stream() + error listener", dir, async (store) => {
      const client = withEvidence(new Anthropic(), { store, systemId: "smoke-live" });
      const stream = client.messages.stream({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: PROMPT }],
      });
      // ADR-0011 open question: does an attached error listener change
      // unhandled-error reporting on the SDK's MessageStream?
      let errorSeen: Error | null = null;
      stream.on("error", (err) => {
        errorSeen = err;
      });
      await stream.finalMessage();
      if (errorSeen) {
        throw errorSeen;
      }
    });
  }

  if (openaiKey) {
    const { generateText, streamText, wrapLanguageModel } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { evidenceMiddleware } = await import("@gsengai/ai-sdk");
    const provider = createOpenAI({ apiKey: openaiKey });
    const model = process.env.GSENGAI_SMOKE_OPENAI_MODEL ?? "gpt-4o-mini";

    await run("ai-sdk generateText", dir, async (store) => {
      const wrapped = wrapLanguageModel({
        model: provider(model),
        middleware: evidenceMiddleware({ store, systemId: "smoke-live" }),
      });
      await generateText({ model: wrapped, prompt: PROMPT });
    });

    await run("ai-sdk streamText", dir, async (store) => {
      const wrapped = wrapLanguageModel({
        model: provider(model),
        middleware: evidenceMiddleware({ store, systemId: "smoke-live" }),
      });
      const { textStream } = streamText({ model: wrapped, prompt: PROMPT });
      for await (const _delta of textStream) {
        // consume fully
      }
    });
  }

  console.log("\n=== smoke-live results ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.path}: ${r.outcome}`);
  }
  rmSync(dir, { recursive: true, force: true });
  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
}

await main();
