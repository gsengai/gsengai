// SPDX-License-Identifier: Apache-2.0
// Compatibility against the real OpenAI SDK (the other tests use hand-written
// mocks). A real `OpenAI` client talks to a fake `fetch` serving recorded-shape
// JSON and server-sent events, so the SDK's own parsing, streaming, and
// APIPromise code runs through the wrapper — with no network access. A breaking
// SDK release (e.g. a Dependabot bump) fails here.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceStore, type EvidenceStore, sha256Hex } from "@gsengai/core";
import { withEvidence } from "@gsengai/openai";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let store: EvidenceStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-openai-compat-"));
  store = createEvidenceStore({ path: join(dir, "evidence.db") });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const sse = (events: { event?: string; data: unknown }[]): Response =>
  new Response(
    `${events
      .map(
        (e) =>
          `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`,
      )
      .join("")}`,
    { headers: { "content-type": "text/event-stream" } },
  );

/** A real client whose every request is answered by `respond` — never the network. */
function realClient(respond: (path: string, body: Record<string, unknown>) => Response): OpenAI {
  return new OpenAI({
    apiKey: "sdk-compat-test",
    baseURL: "http://sdk-compat.invalid/v1",
    maxRetries: 0,
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return respond(url.pathname, body);
    },
  });
}

const chatCompletion = (content: string) => ({
  id: "chatcmpl-compat",
  object: "chat.completion",
  created: 0,
  model: "gpt-compat",
  choices: [
    { index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null },
  ],
});

const chatChunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: "chatcmpl-compat",
  object: "chat.completion.chunk",
  created: 0,
  model: "gpt-compat",
  choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
});

const message = { role: "user" as const, content: "say hello" };

describe(`@gsengai/openai against the real openai SDK (${OpenAI.name} client)`, () => {
  it("chat.completions.create, non-streaming: recorded, response unmodified, APIPromise helpers intact", async () => {
    const client = withEvidence(
      realClient(() => json(chatCompletion("hello compat"))),
      { store, systemId: "compat" },
    );
    const promise = client.chat.completions.create({ model: "gpt-compat", messages: [message] });
    // Fail-open returns the SDK's own APIPromise, so its helpers still work.
    const { data, response } = await promise.withResponse();
    expect(response.status).toBe(200);
    expect(data.choices[0]?.message.content).toBe("hello compat");
    await new Promise((resolve) => setImmediate(resolve)); // recording happens on the side
    const records = store.findByOutputHash(sha256Hex("hello compat"));
    expect(records).toHaveLength(1);
    expect(records[0]?.model).toBe("gpt-compat");
  });

  it("chat.completions.create, streaming: deltas recorded once the stream is consumed; Stream API intact", async () => {
    const client = withEvidence(
      realClient(() =>
        sse([
          { data: chatChunk({ role: "assistant", content: "hel" }) },
          { data: chatChunk({ content: "lo" }) },
          { data: chatChunk({}, "stop") },
          { data: "[DONE]" },
        ]),
      ),
      { store, systemId: "compat" },
    );
    const stream = await client.chat.completions.create({
      model: "gpt-compat",
      messages: [message],
      stream: true,
    });
    expect(typeof stream.toReadableStream).toBe("function");
    let delivered = "";
    for await (const chunk of stream) {
      delivered += chunk.choices[0]?.delta.content ?? "";
    }
    expect(delivered).toBe("hello");
    expect(store.findByOutputHash(sha256Hex("hello"))).toHaveLength(1);
  });

  it("responses.create, non-streaming: the SDK's output_text is recorded", async () => {
    const client = withEvidence(
      realClient(() =>
        json({
          id: "resp_compat",
          object: "response",
          created_at: 0,
          status: "completed",
          model: "gpt-compat",
          output: [
            {
              type: "message",
              id: "msg_compat",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "responses compat", annotations: [] }],
            },
          ],
        }),
      ),
      { store, systemId: "compat" },
    );
    const response = await client.responses.create({ model: "gpt-compat", input: "say hello" });
    expect(response.output_text).toBe("responses compat");
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.findByOutputHash(sha256Hex("responses compat"))).toHaveLength(1);
  });

  it("responses.create, streaming: output_text deltas recorded", async () => {
    const created = {
      id: "resp_compat",
      object: "response",
      model: "gpt-compat",
      status: "in_progress",
      output: [],
    };
    const client = withEvidence(
      realClient(() =>
        sse([
          {
            event: "response.created",
            data: { type: "response.created", sequence_number: 0, response: created },
          },
          {
            event: "response.output_text.delta",
            data: {
              type: "response.output_text.delta",
              sequence_number: 1,
              item_id: "msg_compat",
              output_index: 0,
              content_index: 0,
              delta: "stream",
            },
          },
          {
            event: "response.output_text.delta",
            data: {
              type: "response.output_text.delta",
              sequence_number: 2,
              item_id: "msg_compat",
              output_index: 0,
              content_index: 0,
              delta: "ed compat",
            },
          },
          {
            event: "response.completed",
            data: {
              type: "response.completed",
              sequence_number: 3,
              response: { ...created, status: "completed" },
            },
          },
        ]),
      ),
      { store, systemId: "compat" },
    );
    const stream = await client.responses.create({
      model: "gpt-compat",
      input: "say hello",
      stream: true,
    });
    for await (const _event of stream) {
      // consume fully
    }
    const records = store.findByOutputHash(sha256Hex("streamed compat"));
    expect(records).toHaveLength(1);
    expect(records[0]?.model).toBe("gpt-compat");
  });
});
