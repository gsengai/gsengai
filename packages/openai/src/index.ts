// SPDX-License-Identifier: Apache-2.0
import {
  type EvidenceWrapperOptions,
  type FailMode,
  hashPrompt,
  instrumentAsyncIterable,
  safeAppend,
} from "@gsengai/core";

/**
 * Evidence-logging wrapper for the OpenAI Node SDK (peer: openai@^6).
 *
 * Captures `chat.completions.create` and `responses.create`, streaming and
 * non-streaming. Per PRD A2/A3 the wrapper hashes the generated text in memory,
 * appends one evidence record per generated text, and returns the SDK's response
 * unmodified — it never mutates or blocks model output. Failure semantics are
 * fail-open by default (PRD A3); `failMode: 'strict'` opts into throwing.
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

/** Pass non-wrapped members through, binding methods so classes with private fields keep working. */
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
    return; // PRD A6: responses with no text content (pure tool calls) are not recorded.
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

/** Texts of all text-bearing choices, in choice-index order (one record per generation, PRD A2). */
function chatChoiceTexts(response: unknown): string[] {
  if (!isObject(response) || !Array.isArray(response.choices)) {
    return [];
  }
  const texts: string[] = [];
  for (const choice of response.choices) {
    if (!isObject(choice)) {
      continue;
    }
    const message = isObject(choice.message) ? choice.message : undefined;
    const content = message?.content;
    if (typeof content === "string" && content.length > 0) {
      texts.push(content);
    }
  }
  return texts;
}

/** Aggregated output text of a Responses API response (`output_text`, else walk the output items). */
function responseOutputText(response: unknown): string {
  if (!isObject(response)) {
    return "";
  }
  if (typeof response.output_text === "string" && response.output_text.length > 0) {
    return response.output_text;
  }
  let text = "";
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (isObject(part) && part.type === "output_text" && typeof part.text === "string") {
        text += part.text;
      }
    }
  }
  return text;
}

function instrumentChatStream(
  stream: object,
  cfg: WrapperConfig,
  fallbackModel: string,
  promptSource: unknown,
): object {
  const texts = new Map<number, string>();
  let model = "";
  return instrumentAsyncIterable(stream, {
    onValue(chunk: unknown): void {
      if (!isObject(chunk)) {
        return;
      }
      if (!model) {
        model = stringOr(chunk.model, "");
      }
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      for (const choice of choices) {
        if (!isObject(choice)) {
          continue;
        }
        const delta = isObject(choice.delta) ? choice.delta : undefined;
        const content = delta?.content;
        if (typeof content === "string" && content.length > 0) {
          const index = typeof choice.index === "number" ? choice.index : 0;
          texts.set(index, (texts.get(index) ?? "") + content);
        }
      }
    },
    onDone(): void {
      // PRD A4: hash what was actually delivered — including partial output on abort.
      const finalModel = model || fallbackModel;
      for (const [, text] of [...texts.entries()].sort((a, b) => a[0] - b[0])) {
        appendTextRecord(cfg, text, finalModel, promptSource);
      }
    },
  });
}

function instrumentResponsesStream(
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
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
      }
      if (!model && isObject(event.response)) {
        model = stringOr(event.response.model, "");
      }
    },
    onDone(): void {
      appendTextRecord(cfg, text, model || fallbackModel, promptSource);
    },
  });
}

type ExtractText = (response: unknown) => string[];
type InstrumentStream = (
  stream: object,
  cfg: WrapperConfig,
  fallbackModel: string,
  promptSource: unknown,
) => object;

function wrapCreate(
  create: (...args: unknown[]) => unknown,
  cfg: WrapperConfig,
  promptSourceOf: (params: Record<string, unknown> | undefined) => unknown,
  extractTexts: ExtractText,
  instrumentStream: InstrumentStream,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]): unknown => {
    const params = isObject(args[0]) ? args[0] : undefined;
    const promptSource = promptSourceOf(params);
    const fallbackModel = stringOr(params?.model, "unknown");
    const result = create(...args);

    if (params?.stream === true) {
      return Promise.resolve(result).then((stream) =>
        isObject(stream) ? instrumentStream(stream, cfg, fallbackModel, promptSource) : stream,
      );
    }

    const record = (response: unknown): void => {
      const model = stringOr(isObject(response) ? response.model : undefined, fallbackModel);
      for (const text of extractTexts(response)) {
        appendTextRecord(cfg, text, model, promptSource);
      }
    };

    if (cfg.failMode === "strict") {
      return Promise.resolve(result).then((response) => {
        record(response);
        return response;
      });
    }
    // Fail-open default: observe on the side and return the SDK's promise untouched,
    // so APIPromise helpers (e.g. .withResponse()) keep working. `record` cannot throw
    // in open mode (safeAppend catches), and a rejected request has delivered nothing.
    void Promise.resolve(result).then(record, () => {});
    return result;
  };
}

function proxyCreateHolder(
  holder: Record<string, unknown>,
  makeWrapped: (create: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
): object {
  return new Proxy(holder, {
    get(target, prop) {
      if (prop === "create") {
        const create = Reflect.get(target, prop, target);
        if (typeof create === "function") {
          return makeWrapped((create as (...args: unknown[]) => unknown).bind(target));
        }
      }
      return passthroughGet(target, prop);
    },
  });
}

function proxyChat(chat: Record<string, unknown>, cfg: WrapperConfig): object {
  return new Proxy(chat, {
    get(target, prop) {
      if (prop === "completions") {
        const completions = Reflect.get(target, prop, target);
        if (isObject(completions)) {
          return proxyCreateHolder(completions, (create) =>
            wrapCreate(
              create,
              cfg,
              (params) => params?.messages,
              chatChoiceTexts,
              instrumentChatStream,
            ),
          );
        }
      }
      return passthroughGet(target, prop);
    },
  });
}

/**
 * Wrap an OpenAI client with evidence logging. The client object is not mutated;
 * a Proxy is returned. Any member other than `chat.completions.create` and
 * `responses.create` passes through untouched.
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
      if (prop === "chat") {
        const chat = Reflect.get(target, prop, target);
        if (isObject(chat)) {
          return proxyChat(chat, cfg);
        }
      }
      if (prop === "responses") {
        const responses = Reflect.get(target, prop, target);
        if (isObject(responses)) {
          return proxyCreateHolder(responses, (create) =>
            wrapCreate(
              create,
              cfg,
              (params) => params?.input,
              (response) => {
                const text = responseOutputText(response);
                return text ? [text] : [];
              },
              instrumentResponsesStream,
            ),
          );
        }
      }
      return passthroughGet(target, prop);
    },
  }) as T;
}
