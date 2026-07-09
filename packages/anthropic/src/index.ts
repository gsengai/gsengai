// SPDX-License-Identifier: Apache-2.0
import {
  type EvidenceWrapperOptions,
  type FailMode,
  hashPrompt,
  instrumentAsyncIterable,
  safeAppend,
} from "@gsengai/core";

/**
 * Evidence-logging wrapper for the Anthropic TypeScript SDK (peer: @anthropic-ai/sdk).
 *
 * Captures `messages.create` (stream and non-stream) and the `messages.stream()`
 * helper. Text blocks are concatenated in order with no separators. Per PRD A2/A3
 * the wrapper hashes generated text in memory, appends one evidence record per
 * generation, and returns the SDK's response unmodified — it never mutates or
 * blocks model output. Fail-open by default; `failMode: 'strict'` opts into throwing.
 */

interface WrapperConfig {
  store: EvidenceWrapperOptions["store"];
  systemId: string;
  capturePromptHash: boolean;
  failMode: FailMode;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function passthroughGet(target: object, prop: string | symbol): unknown {
  const value: unknown = Reflect.get(target, prop, target);
  return typeof value === "function"
    ? (value as (...args: never[]) => unknown).bind(target)
    : value;
}

function appendTextRecord(
  cfg: WrapperConfig,
  text: string,
  model: string,
  promptSource: unknown,
): void {
  if (!text) {
    return; // PRD A6: responses with no text content (pure tool use) are not recorded.
  }
  safeAppend(
    cfg.store,
    () => ({
      modality: "text",
      model,
      systemId: cfg.systemId,
      outputText: text,
      promptHash:
        cfg.capturePromptHash && promptSource !== undefined ? hashPrompt(promptSource) : null,
    }),
    cfg.failMode,
  );
}

/** Concatenate the text blocks of a Message, in order, with no separators. */
function messageText(message: unknown): string {
  if (!isObject(message) || !Array.isArray(message.content)) {
    return "";
  }
  let text = "";
  for (const block of message.content) {
    if (isObject(block) && block.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  return text;
}

function instrumentEventStream(
  stream: object,
  cfg: WrapperConfig,
  fallbackModel: string,
  promptSource: unknown,
): object {
  let text = "";
  let model = "";
  return instrumentAsyncIterable(stream, {
    onValue(event: unknown): void {
      if (!isObject(event)) {
        return;
      }
      switch (event.type) {
        case "message_start": {
          if (!model && isObject(event.message)) {
            model = stringOr(event.message.model, "");
          }
          break;
        }
        case "content_block_start": {
          const block = isObject(event.content_block) ? event.content_block : undefined;
          if (block?.type === "text" && typeof block.text === "string") {
            text += block.text;
          }
          break;
        }
        case "content_block_delta": {
          const delta = isObject(event.delta) ? event.delta : undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            text += delta.text;
          }
          break;
        }
        default:
          break;
      }
    },
    onDone(): void {
      // PRD A4: hash what was actually delivered — including partial output on abort.
      appendTextRecord(cfg, text, model || fallbackModel, promptSource);
    },
  });
}

/**
 * Attach evidence recording to a MessageStream (`messages.stream()` helper).
 * The stream object is returned as-is — MessageStream uses private fields, so it
 * must not be proxied; listeners observe without interfering (PRD A3).
 */
function attachMessageStreamRecorder(
  ms: unknown,
  cfg: WrapperConfig,
  params: Record<string, unknown> | undefined,
): void {
  if (!isObject(ms) || typeof ms.on !== "function") {
    return; // Unknown stream shape: pass through unrecorded rather than interfere.
  }
  const on = (ms.on as (event: string, listener: (...cbArgs: unknown[]) => void) => unknown).bind(
    ms,
  );
  let text = "";
  let model = "";
  let finalized = false;
  const finalize = (): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    appendTextRecord(cfg, text, model || stringOr(params?.model, "unknown"), params?.messages);
  };
  on("text", (delta) => {
    if (typeof delta === "string") {
      text += delta;
    }
  });
  on("streamEvent", (event) => {
    if (!model && isObject(event) && event.type === "message_start" && isObject(event.message)) {
      model = stringOr(event.message.model, "");
    }
  });
  on("end", finalize);
  on("abort", finalize); // PRD A4: record what was emitted up to the abort.
  on("error", finalize);
}

function wrapMessagesCreate(
  create: (...args: unknown[]) => unknown,
  cfg: WrapperConfig,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]): unknown => {
    const params = isObject(args[0]) ? args[0] : undefined;
    const promptSource = params?.messages;
    const fallbackModel = stringOr(params?.model, "unknown");
    const result = create(...args);

    if (params?.stream === true) {
      return Promise.resolve(result).then((stream) =>
        isObject(stream) ? instrumentEventStream(stream, cfg, fallbackModel, promptSource) : stream,
      );
    }

    const record = (message: unknown): void => {
      const model = stringOr(isObject(message) ? message.model : undefined, fallbackModel);
      appendTextRecord(cfg, messageText(message), model, promptSource);
    };

    if (cfg.failMode === "strict") {
      return Promise.resolve(result).then((message) => {
        record(message);
        return message;
      });
    }
    // Fail-open default: observe on the side, return the SDK's promise untouched.
    void Promise.resolve(result).then(record, () => {});
    return result;
  };
}

function proxyMessages(messages: Record<string, unknown>, cfg: WrapperConfig): object {
  return new Proxy(messages, {
    get(target, prop) {
      if (prop === "create") {
        const create = Reflect.get(target, prop, target);
        if (typeof create === "function") {
          return wrapMessagesCreate((create as (...args: unknown[]) => unknown).bind(target), cfg);
        }
      }
      if (prop === "stream") {
        const streamFn = Reflect.get(target, prop, target);
        if (typeof streamFn === "function") {
          const bound = (streamFn as (...args: unknown[]) => unknown).bind(target);
          return (...args: unknown[]): unknown => {
            const ms = bound(...args);
            try {
              attachMessageStreamRecorder(ms, cfg, isObject(args[0]) ? args[0] : undefined);
            } catch {
              // Fail-open: evidence attachment must never break the stream (PRD A3).
            }
            return ms;
          };
        }
      }
      return passthroughGet(target, prop);
    },
  });
}

/**
 * Wrap an Anthropic client with evidence logging. The client object is not mutated;
 * a Proxy is returned. Any member other than `messages.create` and `messages.stream`
 * passes through untouched.
 */
export function withEvidence<T extends object>(client: T, options: EvidenceWrapperOptions): T {
  const cfg: WrapperConfig = {
    store: options.store,
    systemId: options.systemId,
    capturePromptHash: options.capturePromptHash ?? true,
    failMode: options.failMode ?? "open",
  };
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "messages") {
        const messages = Reflect.get(target, prop, target);
        if (isObject(messages)) {
          return proxyMessages(messages, cfg);
        }
      }
      return passthroughGet(target, prop);
    },
  }) as T;
}
