// SPDX-License-Identifier: Apache-2.0
// Compatibility against the real Anthropic SDK (the other tests use
// hand-written mocks). A real `Anthropic` client talks to a fake `fetch`
// serving recorded-shape JSON and server-sent events, so the SDK's own parsing,
// streaming, and MessageStream code runs through the wrapper — with no network
// access. A breaking SDK release (e.g. a Dependabot bump) fails here.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { withEvidence } from "@gsengai/anthropic";
import { createEvidenceStore, type EvidenceStore, sha256Hex } from "@gsengai/core";
import { satisfies } from "semver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let store: EvidenceStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsengai-anthropic-compat-"));
  store = createEvidenceStore({ path: join(dir, "evidence.db") });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const MODEL = "claude-compat";

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const sse = (events: Record<string, unknown>[]): Response =>
  new Response(
    events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

/** A real client whose every request is answered by `respond` — never the network. */
function realClient(respond: () => Response): Anthropic {
  return new Anthropic({
    apiKey: "sdk-compat-test",
    baseURL: "http://sdk-compat.invalid",
    maxRetries: 0,
    fetch: async (): Promise<Response> => respond(),
  });
}

const message = (text: string) => ({
  id: "msg_compat",
  type: "message",
  role: "assistant",
  model: MODEL,
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 3, output_tokens: 2 },
});

/** The event sequence of a streamed two-delta text reply. */
const streamedReply = (first: string, second: string): Record<string, unknown>[] => [
  { type: "message_start", message: { ...message(""), content: [], stop_reason: null } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: first } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: second } },
  { type: "content_block_stop", index: 0 },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 2 },
  },
  { type: "message_stop" },
];

const params = {
  model: MODEL,
  max_tokens: 16,
  messages: [{ role: "user" as const, content: "say hello" }],
};

describe("@gsengai/anthropic against the real @anthropic-ai/sdk", () => {
  it("messages.create, non-streaming: recorded, response unmodified, APIPromise helpers intact", async () => {
    const client = withEvidence(
      realClient(() => json(message("hello compat"))),
      {
        store,
        systemId: "compat",
      },
    );
    const { data, response } = await client.messages.create(params).withResponse();
    expect(response.status).toBe(200);
    expect(data.content[0]).toMatchObject({ type: "text", text: "hello compat" });
    await new Promise((resolve) => setImmediate(resolve)); // recording happens on the side
    const records = store.findByOutputHash(sha256Hex("hello compat"));
    expect(records).toHaveLength(1);
    expect(records[0]?.model).toBe(MODEL);
  });

  it("messages.create({ stream: true }): text deltas recorded once the stream is consumed", async () => {
    const client = withEvidence(
      realClient(() => sse(streamedReply("hel", "lo"))),
      {
        store,
        systemId: "compat",
      },
    );
    const stream = await client.messages.create({ ...params, stream: true });
    let delivered = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        delivered += event.delta.text;
      }
    }
    expect(delivered).toBe("hello");
    const records = store.findByOutputHash(sha256Hex("hello"));
    expect(records).toHaveLength(1);
    expect(records[0]?.model).toBe(MODEL);
  });

  it("messages.stream() helper: recorded via MessageStream events; the caller's listeners and finalMessage() still work", async () => {
    const client = withEvidence(
      realClient(() => sse(streamedReply("streamed ", "helper"))),
      {
        store,
        systemId: "compat",
      },
    );
    const stream = client.messages.stream(params);
    let seenByCaller = "";
    stream.on("text", (delta) => {
      seenByCaller += delta;
    });
    const final = await stream.finalMessage();
    expect(final.content[0]).toMatchObject({ type: "text", text: "streamed helper" });
    expect(seenByCaller).toBe("streamed helper");
    const records = store.findByOutputHash(sha256Hex("streamed helper"));
    expect(records).toHaveLength(1);
    expect(records[0]?.model).toBe(MODEL);
  });
});

// The tests above can pass on a new SDK major (e.g. a Dependabot bump) while
// npm still refuses to install @gsengai/anthropic next to it, because the published
// peer range excludes it. That gap went unnoticed for three months when
// openai 7 shipped. Widening the range is a release decision, so fail here.
describe("@gsengai/anthropic peer range", () => {
  it("includes the @anthropic-ai/sdk version these tests ran against", () => {
    const readJson = (rel: string): { version: string; peerDependencies: Record<string, string> } =>
      JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
    const range = readJson("../package.json").peerDependencies["@anthropic-ai/sdk"];
    const tested = readJson("../node_modules/@anthropic-ai/sdk/package.json").version;
    expect(
      range !== undefined && satisfies(tested, range),
      `@anthropic-ai/sdk ${tested} is outside @gsengai/anthropic's peerDependencies range "${range}": widen it (and release)`,
    ).toBe(true);
  });
});
