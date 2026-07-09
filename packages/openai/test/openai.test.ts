// SPDX-License-Identifier: Apache-2.0

import {
  createEvidenceStore,
  type EvidenceStore,
  getLostRecordCount,
  hashPrompt,
  resetLostRecordCount,
  sha256Hex,
} from "@gsengai/core";
import { withEvidence } from "@gsengai/openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MESSAGES = [{ role: "user", content: "Say hi" }];

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

function chatResponse(content: string | null, extraMessage: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    model: "gpt-6-mock",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, ...extraMessage },
        finish_reason: "stop",
      },
    ],
  };
}

/** Minimal async-iterable standing in for the SDK's Stream class, with an extra property. */
function makeStream<T>(chunks: T[]): AsyncIterable<T> & { marker: string } {
  return {
    marker: "sdk-stream-prop",
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function mockClient(
  chatImpl: (params: unknown) => unknown,
  responsesImpl?: (params: unknown) => unknown,
) {
  return {
    apiKey: "sk-mock",
    chat: { completions: { create: vi.fn(async (params: unknown) => chatImpl(params)) } },
    responses: { create: vi.fn(async (params: unknown) => responsesImpl?.(params)) },
    embeddings: { create: vi.fn(async () => ({ object: "list", data: [] })) },
  };
}

describe("@gsengai/openai — chat.completions.create, non-streaming", () => {
  it("captures the generation and returns the SDK response unmodified", async () => {
    const response = chatResponse("Hello from mock");
    const wrapped = withEvidence(
      mockClient(() => response),
      { store, systemId: "svc-a" },
    );

    const result = await wrapped.chat.completions.create({ model: "gpt-6", messages: MESSAGES });

    expect(result).toBe(response); // returned untouched (PRD A3)
    expect(store.count()).toBe(1);
    const [record] = store.findByText("Hello from mock");
    expect(record?.output_hash).toBe(sha256Hex("Hello from mock"));
    expect(record?.prompt_hash).toBe(hashPrompt(MESSAGES)); // captured by default
    expect(record?.marking_methods).toEqual(["logging"]);
    expect(record?.modality).toBe("text");
  });

  it("records system_id and the provider-reported model", async () => {
    const wrapped = withEvidence(
      mockClient(() => chatResponse("text")),
      {
        store,
        systemId: "svc-checkout",
      },
    );
    await wrapped.chat.completions.create({ model: "gpt-6-requested", messages: MESSAGES });
    const [record] = store.findByText("text");
    expect(record?.system_id).toBe("svc-checkout");
    expect(record?.model).toBe("gpt-6-mock"); // response.model wins over params.model
  });

  it("skips responses with no text content (pure tool calls, PRD A6)", async () => {
    const toolResponse = chatResponse(null, {
      tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }],
    });
    const wrapped = withEvidence(
      mockClient(() => toolResponse),
      { store, systemId: "svc" },
    );
    const result = await wrapped.chat.completions.create({ model: "gpt-6", messages: MESSAGES });
    expect(result).toBe(toolResponse);
    expect(store.count()).toBe(0);
  });

  it("appends one record per text-bearing choice when n > 1", async () => {
    const response = {
      model: "gpt-6-mock",
      choices: [
        { index: 0, message: { role: "assistant", content: "Choice A" }, finish_reason: "stop" },
        { index: 1, message: { role: "assistant", content: "Choice B" }, finish_reason: "stop" },
      ],
    };
    const wrapped = withEvidence(
      mockClient(() => response),
      { store, systemId: "svc" },
    );
    await wrapped.chat.completions.create({ model: "gpt-6", n: 2, messages: MESSAGES });
    expect(store.count()).toBe(2);
    expect(store.findByText("Choice A")).toHaveLength(1);
    expect(store.findByText("Choice B")).toHaveLength(1);
  });

  it("omits the prompt hash when capturePromptHash is false", async () => {
    const wrapped = withEvidence(
      mockClient(() => chatResponse("no prompt hash")),
      {
        store,
        systemId: "svc",
        capturePromptHash: false,
      },
    );
    await wrapped.chat.completions.create({ model: "gpt-6", messages: MESSAGES });
    expect(store.findByText("no prompt hash")[0]?.prompt_hash).toBeNull();
  });
});

describe("@gsengai/openai — chat.completions.create, streaming", () => {
  const streamChunks = [
    { id: "c1", model: "gpt-6-mock", choices: [{ index: 0, delta: { role: "assistant" } }] },
    { id: "c1", model: "gpt-6-mock", choices: [{ index: 0, delta: { content: "Str" } }] },
    { id: "c1", model: "gpt-6-mock", choices: [{ index: 0, delta: { content: "eam" } }] },
    { id: "c1", model: "gpt-6-mock", choices: [{ index: 0, delta: { content: "ed!" } }] },
    { id: "c1", model: "gpt-6-mock", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];

  it("accumulates deltas, passes chunks through unmodified, records on completion", async () => {
    const wrapped = withEvidence(
      mockClient(() => makeStream(streamChunks)),
      { store, systemId: "svc-stream" },
    );
    const stream = await wrapped.chat.completions.create({
      model: "gpt-6",
      messages: MESSAGES,
      stream: true,
    });

    const seen: unknown[] = [];
    for await (const chunk of stream as AsyncIterable<unknown>) {
      seen.push(chunk);
    }
    expect(seen).toEqual(streamChunks); // untouched pass-through
    expect((stream as { marker: string }).marker).toBe("sdk-stream-prop"); // SDK props survive
    expect(store.count()).toBe(1);
    const [record] = store.findByText("Streamed!");
    expect(record?.model).toBe("gpt-6-mock");
    expect(record?.prompt_hash).toBe(hashPrompt(MESSAGES));
  });

  it("on abort, records exactly the text delivered so far (PRD A4)", async () => {
    const wrapped = withEvidence(
      mockClient(() => makeStream(streamChunks)),
      { store, systemId: "svc" },
    );
    const stream = await wrapped.chat.completions.create({
      model: "gpt-6",
      messages: MESSAGES,
      stream: true,
    });

    let consumed = 0;
    for await (const _chunk of stream as AsyncIterable<unknown>) {
      consumed += 1;
      if (consumed === 3) {
        break; // abort mid-stream after "Str" + "eam"
      }
    }
    expect(store.count()).toBe(1);
    expect(store.findByText("Stream")).toHaveLength(1);
    expect(store.findByText("Streamed!")).toHaveLength(0);
  });

  it("records nothing for tool-call-only streams", async () => {
    const toolChunks = [
      { model: "gpt-6-mock", choices: [{ index: 0, delta: { role: "assistant" } }] },
      {
        model: "gpt-6-mock",
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { name: "f", arguments: "{" } }] },
          },
        ],
      },
      { model: "gpt-6-mock", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const wrapped = withEvidence(
      mockClient(() => makeStream(toolChunks)),
      {
        store,
        systemId: "svc",
      },
    );
    const stream = await wrapped.chat.completions.create({
      model: "gpt-6",
      messages: MESSAGES,
      stream: true,
    });
    for await (const _chunk of stream as AsyncIterable<unknown>) {
      // consume fully
    }
    expect(store.count()).toBe(0);
  });
});

describe("@gsengai/openai — responses.create", () => {
  it("captures non-streaming responses via output_text or the output items", async () => {
    const direct = { id: "r1", model: "gpt-6-mock", output_text: "Direct text", output: [] };
    const walked = {
      id: "r2",
      model: "gpt-6-mock",
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Walked " },
            { type: "output_text", text: "text" },
          ],
        },
      ],
    };
    let call = 0;
    const wrapped = withEvidence(
      mockClient(
        () => ({}),
        () => (call++ === 0 ? direct : walked),
      ),
      { store, systemId: "svc-resp" },
    );

    const first = await wrapped.responses.create({ model: "gpt-6", input: "What?" });
    await wrapped.responses.create({ model: "gpt-6", input: "What else?" });

    expect(first).toBe(direct);
    expect(store.count()).toBe(2);
    expect(store.findByText("Direct text")).toHaveLength(1);
    expect(store.findByText("Walked text")).toHaveLength(1);
    expect(store.findByText("Direct text")[0]?.prompt_hash).toBe(hashPrompt("What?"));
  });

  it("accumulates response.output_text.delta events when streaming", async () => {
    const events = [
      { type: "response.created", response: { id: "r", model: "gpt-6-mock" } },
      { type: "response.output_text.delta", item_id: "i", delta: "Re" },
      { type: "response.output_text.delta", item_id: "i", delta: "sp" },
      { type: "response.output_text.done", item_id: "i", text: "Resp" },
      { type: "response.completed", response: { id: "r", model: "gpt-6-mock" } },
    ];
    const wrapped = withEvidence(
      mockClient(
        () => ({}),
        () => makeStream(events),
      ),
      { store, systemId: "svc-resp" },
    );
    const stream = await wrapped.responses.create({
      model: "gpt-6",
      input: "Stream it",
      stream: true,
    });
    const seen: unknown[] = [];
    for await (const event of stream as AsyncIterable<unknown>) {
      seen.push(event);
    }
    expect(seen).toEqual(events);
    expect(store.count()).toBe(1); // deltas counted once, .done event not double-counted
    const [record] = store.findByText("Resp");
    expect(record?.model).toBe("gpt-6-mock");
  });
});

describe("@gsengai/openai — failure semantics (PRD A3)", () => {
  const brokenStore = {
    append(): never {
      throw new Error("evidence db down");
    },
  } as unknown as EvidenceStore;

  it("fail-open (default): response still returned, counter incremented, warning emitted", async () => {
    const response = chatResponse("survives failure");
    const wrapped = withEvidence(
      mockClient(() => response),
      {
        store: brokenStore,
        systemId: "svc",
      },
    );

    const result = await wrapped.chat.completions.create({ model: "gpt-6", messages: MESSAGES });

    expect(result).toBe(response);
    expect(getLostRecordCount()).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("Evidence record LOST");
  });

  it("strict mode: the evidence failure is thrown to the caller", async () => {
    const wrapped = withEvidence(
      mockClient(() => chatResponse("never recorded")),
      {
        store: brokenStore,
        systemId: "svc",
        failMode: "strict",
      },
    );
    await expect(
      wrapped.chat.completions.create({ model: "gpt-6", messages: MESSAGES }),
    ).rejects.toThrow("evidence db down");
    expect(getLostRecordCount()).toBe(0);
  });
});

describe("@gsengai/openai — client passthrough", () => {
  it("leaves non-wrapped members untouched and functional", async () => {
    const client = mockClient(() => chatResponse("x"));
    const wrapped = withEvidence(client, { store, systemId: "svc" });

    expect(wrapped.apiKey).toBe("sk-mock");
    const embeddings = await wrapped.embeddings.create();
    expect(embeddings).toEqual({ object: "list", data: [] });
    expect(store.count()).toBe(0); // nothing recorded for non-generation calls
  });
});
