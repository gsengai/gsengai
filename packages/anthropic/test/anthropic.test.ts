// SPDX-License-Identifier: Apache-2.0

import { withEvidence } from "@gsengai/anthropic";
import {
  createEvidenceStore,
  type EvidenceStore,
  hashPrompt,
  resetLostRecordCount,
  sha256Hex,
} from "@gsengai/core";
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

function makeStream<T>(events: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/** Minimal stand-in for the SDK's MessageStream event emitter (`messages.stream()`). */
class MockMessageStream {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

function mockClient(
  createImpl: (params: unknown) => unknown,
  streamImpl?: () => MockMessageStream,
) {
  return {
    apiKey: "sk-ant-mock",
    messages: {
      create: vi.fn(async (params: unknown) => createImpl(params)),
      stream: vi.fn((_params: unknown) => streamImpl?.() ?? new MockMessageStream()),
      batches: { create: vi.fn(async () => ({ id: "batch" })) },
    },
  };
}

describe("@gsengai/anthropic — messages.create, non-streaming", () => {
  it("concatenates text blocks in order with no separators and returns the message unmodified", async () => {
    const message = {
      id: "msg-mock",
      type: "message",
      role: "assistant",
      model: "claude-fable-5-mock",
      content: [
        { type: "text", text: "Hello " },
        { type: "tool_use", id: "tu1", name: "search", input: { q: "x" } },
        { type: "text", text: "world" },
      ],
    };
    const wrapped = withEvidence(
      mockClient(() => message),
      { store, systemId: "svc-claude" },
    );

    const result = await wrapped.messages.create({ model: "claude-fable-5", messages: MESSAGES });

    expect(result).toBe(message);
    expect(store.count()).toBe(1);
    const [record] = store.findByText("Hello world");
    expect(record?.output_hash).toBe(sha256Hex("Hello world"));
    expect(record?.model).toBe("claude-fable-5-mock");
    expect(record?.system_id).toBe("svc-claude");
    expect(record?.prompt_hash).toBe(hashPrompt(MESSAGES));
  });

  it("skips tool-use-only messages (PRD A6)", async () => {
    const message = {
      model: "claude-fable-5-mock",
      content: [{ type: "tool_use", id: "tu1", name: "search", input: {} }],
    };
    const wrapped = withEvidence(
      mockClient(() => message),
      { store, systemId: "svc" },
    );
    await wrapped.messages.create({ model: "claude-fable-5", messages: MESSAGES });
    expect(store.count()).toBe(0);
  });
});

describe("@gsengai/anthropic — messages.create, streaming", () => {
  it("accumulates text_delta events and records on completion", async () => {
    const events = [
      { type: "message_start", message: { id: "m", model: "claude-fable-5-mock", content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "An" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "thro" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ];
    const wrapped = withEvidence(
      mockClient(() => makeStream(events)),
      {
        store,
        systemId: "svc-claude",
      },
    );

    const stream = await wrapped.messages.create({
      model: "claude-fable-5",
      messages: MESSAGES,
      stream: true,
    });
    const seen: unknown[] = [];
    for await (const event of stream as AsyncIterable<unknown>) {
      seen.push(event);
    }

    expect(seen).toEqual(events); // untouched pass-through
    expect(store.count()).toBe(1);
    const [record] = store.findByText("Anthro");
    expect(record?.model).toBe("claude-fable-5-mock");
  });

  it("on early break, records the partial text delivered so far (PRD A4)", async () => {
    const events = [
      { type: "message_start", message: { model: "claude-fable-5-mock" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "par" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "tial" } },
      { type: "message_stop" },
    ];
    const wrapped = withEvidence(
      mockClient(() => makeStream(events)),
      {
        store,
        systemId: "svc",
      },
    );
    const stream = await wrapped.messages.create({
      model: "claude-fable-5",
      messages: MESSAGES,
      stream: true,
    });
    let consumed = 0;
    for await (const _event of stream as AsyncIterable<unknown>) {
      consumed += 1;
      if (consumed === 2) {
        break;
      }
    }
    expect(store.count()).toBe(1);
    expect(store.findByText("par")).toHaveLength(1);
    expect(store.findByText("partial")).toHaveLength(0);
  });
});

describe("@gsengai/anthropic — messages.stream() helper", () => {
  it("records accumulated text on end, exactly once, returning the same stream object", async () => {
    const ms = new MockMessageStream();
    const wrapped = withEvidence(
      mockClient(
        () => ({}),
        () => ms,
      ),
      {
        store,
        systemId: "svc-helper",
      },
    );

    const returned = wrapped.messages.stream({ model: "claude-fable-5", messages: MESSAGES });
    expect(returned).toBe(ms); // MessageStream is observed, never proxied

    ms.emit("streamEvent", { type: "message_start", message: { model: "claude-fable-5-mock" } });
    ms.emit("text", "Hel", "Hel");
    ms.emit("text", "lo", "Hello");
    ms.emit("end");
    ms.emit("end"); // idempotent finalize

    expect(store.count()).toBe(1);
    const [record] = store.findByText("Hello");
    expect(record?.model).toBe("claude-fable-5-mock");
    expect(record?.prompt_hash).toBe(hashPrompt(MESSAGES));
  });

  it("on abort, records what was emitted up to the abort (PRD A4)", () => {
    const ms = new MockMessageStream();
    const wrapped = withEvidence(
      mockClient(
        () => ({}),
        () => ms,
      ),
      { store, systemId: "svc" },
    );

    wrapped.messages.stream({ model: "claude-fable-5", messages: MESSAGES });
    ms.emit("text", "cut ", "cut ");
    ms.emit("text", "short", "cut short");
    ms.emit("abort", new Error("Request was aborted."));

    expect(store.count()).toBe(1);
    expect(store.findByText("cut short")).toHaveLength(1);
    // model falls back to params.model when message_start never arrived
    expect(store.findByText("cut short")[0]?.model).toBe("claude-fable-5");
  });
});
