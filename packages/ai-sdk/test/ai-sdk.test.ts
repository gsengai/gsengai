// SPDX-License-Identifier: Apache-2.0

import { evidenceMiddleware } from "@gsengai/ai-sdk";
import {
  createEvidenceStore,
  type EvidenceStore,
  hashPrompt,
  resetLostRecordCount,
} from "@gsengai/core";
import { type LanguageModelMiddleware, simulateReadableStream, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GenerateResult = Awaited<ReturnType<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>>;
type StreamResult = Awaited<ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>>;
type CallOptions = Parameters<InstanceType<typeof MockLanguageModelV4>["doGenerate"]>[0];

const PROMPT = [{ role: "user", content: [{ type: "text", text: "Say hi" }] }];
const CALL_PARAMS = { prompt: PROMPT } as unknown as CallOptions;

let store: EvidenceStore;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store = createEvidenceStore({ path: ":memory:" });
  resetLostRecordCount();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  store.close();
  warnSpy.mockRestore();
});

function generateResult(content: unknown[]): GenerateResult {
  return {
    content,
    finishReason: { unified: "stop", raw: "stop" },
    usage: {},
    warnings: [],
  } as unknown as GenerateResult;
}

function wrappedModel(overrides: {
  doGenerate?: GenerateResult;
  doStream?: StreamResult;
  middlewareOptions?: Partial<Parameters<typeof evidenceMiddleware>[0]>;
}) {
  return wrapLanguageModel({
    model: new MockLanguageModelV4({
      modelId: "mock-model-v4",
      ...(overrides.doGenerate ? { doGenerate: overrides.doGenerate } : {}),
      ...(overrides.doStream ? { doStream: overrides.doStream } : {}),
    }),
    middleware: evidenceMiddleware({
      store,
      systemId: "svc-ai-sdk",
      ...overrides.middlewareOptions,
    }),
  });
}

describe("@gsengai/ai-sdk — wrapGenerate", () => {
  it("records text content and returns the result unmodified", async () => {
    const result = generateResult([
      { type: "text", text: "AI SDK " },
      { type: "text", text: "says hi" },
    ]);
    const model = wrappedModel({ doGenerate: result });

    const out = await model.doGenerate(CALL_PARAMS);

    expect(out.content).toBe(result.content); // untouched (PRD A3)
    expect(store.count()).toBe(1);
    const [record] = store.findByText("AI SDK says hi");
    expect(record?.model).toBe("mock-model-v4");
    expect(record?.system_id).toBe("svc-ai-sdk");
    expect(record?.prompt_hash).toBe(hashPrompt(PROMPT)); // from params.prompt
  });

  it("skips tool-call-only results (PRD A6)", async () => {
    const model = wrappedModel({
      doGenerate: generateResult([
        { type: "tool-call", toolCallId: "t1", toolName: "search", input: "{}" },
      ]),
    });
    await model.doGenerate(CALL_PARAMS);
    expect(store.count()).toBe(0);
  });

  it("omits the prompt hash when capturePromptHash is false", async () => {
    const model = wrappedModel({
      doGenerate: generateResult([{ type: "text", text: "no prompt hash" }]),
      middlewareOptions: { capturePromptHash: false },
    });
    await model.doGenerate(CALL_PARAMS);
    expect(store.findByText("no prompt hash")[0]?.prompt_hash).toBeNull();
  });
});

describe("@gsengai/ai-sdk — wrapStream", () => {
  const streamChunks = [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Str" },
    { type: "text-delta", id: "t1", delta: "eamed" },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: {} },
  ];

  function streamResult(): StreamResult {
    return {
      stream: simulateReadableStream({ chunks: streamChunks }),
    } as unknown as StreamResult;
  }

  it("accumulates text-delta parts, passes them through, records on finish", async () => {
    const model = wrappedModel({ doStream: streamResult() });

    const { stream } = await model.doStream(CALL_PARAMS);
    const reader = stream.getReader();
    const seen: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      seen.push(value);
    }

    expect(seen).toEqual(streamChunks); // untouched pass-through
    expect(store.count()).toBe(1);
    const [record] = store.findByText("Streamed");
    expect(record?.model).toBe("mock-model-v4");
    expect(record?.prompt_hash).toBe(hashPrompt(PROMPT));
  });

  it("on cancel, records exactly the parts delivered so far (PRD A4)", async () => {
    const model = wrappedModel({ doStream: streamResult() });

    const { stream } = await model.doStream(CALL_PARAMS);
    const reader = stream.getReader();
    await reader.read(); // text-start
    await reader.read(); // "Str"
    await reader.cancel("user aborted");

    expect(store.count()).toBe(1);
    expect(store.findByText("Str")).toHaveLength(1);
    expect(store.findByText("Streamed")).toHaveLength(0);
  });

  it("records nothing for streams with no text deltas", async () => {
    const model = wrappedModel({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "tool-input-start", id: "t", toolName: "f" },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage: {},
            },
          ],
        }),
      } as unknown as StreamResult,
    });
    const { stream } = await model.doStream(CALL_PARAMS);
    const reader = stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) {
        break;
      }
    }
    expect(store.count()).toBe(0);
  });
});
