// SPDX-License-Identifier: Apache-2.0
import { type EvidenceWrapperOptions, type FailMode, hashPrompt, safeAppend } from "@gsengai/core";
import type { LanguageModelMiddleware } from "ai";

type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
type StreamResult = Awaited<ReturnType<WrapStream>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

/**
 * Evidence-logging `LanguageModelMiddleware` for the Vercel AI SDK (peer: ai@^7),
 * for use with `wrapLanguageModel`. Implements `wrapGenerate` and `wrapStream`:
 * text parts (and streamed `text-delta` parts) are hashed in memory and appended
 * as one evidence record per generation; the prompt hash is taken from
 * `params.prompt` when enabled. Results and stream parts pass through unmodified
 * (PRD A3); on stream cancellation the text delivered so far is recorded (PRD A4).
 */
export function evidenceMiddleware(options: EvidenceWrapperOptions): LanguageModelMiddleware {
  const store = options.store;
  const systemId = options.systemId;
  const capturePromptHash = options.capturePromptHash ?? true;
  const failMode: FailMode = options.failMode ?? "open";

  const record = (text: string, modelId: string, prompt: unknown): void => {
    if (!text) {
      return; // PRD A6: no text content (pure tool calls) → no record.
    }
    safeAppend(
      store,
      () => ({
        modality: "text",
        model: modelId || "unknown",
        systemId,
        outputText: text,
        promptHash: capturePromptHash && prompt !== undefined ? hashPrompt(prompt) : null,
      }),
      failMode,
    );
  };

  return {
    specificationVersion: "v4",

    async wrapGenerate({ doGenerate, params, model }): Promise<GenerateResult> {
      const result = await doGenerate();
      let text = "";
      for (const part of result.content) {
        if (part.type === "text") {
          text += part.text;
        }
      }
      record(text, model.modelId, params.prompt);
      return result;
    },

    async wrapStream({ doStream, params, model }): Promise<StreamResult> {
      const result = await doStream();
      let text = "";
      let finalized = false;
      const finalize = (): void => {
        if (finalized) {
          return;
        }
        finalized = true;
        record(text, model.modelId, params.prompt);
      };

      const reader = result.stream.getReader();
      const stream = new ReadableStream<StreamPart>(
        {
          async pull(controller): Promise<void> {
            let chunk: Awaited<ReturnType<typeof reader.read>>;
            try {
              chunk = await reader.read();
            } catch (err) {
              // Stream error: record what was delivered, then propagate (PRD A4).
              finalize();
              controller.error(err);
              return;
            }
            if (chunk.done) {
              finalize();
              controller.close();
              return;
            }
            const part = chunk.value;
            if (part.type === "text-delta") {
              text += part.delta;
            }
            controller.enqueue(part);
          },
          cancel(reason): Promise<void> {
            // Consumer aborted: record the partial output (PRD A4).
            finalize();
            return reader.cancel(reason);
          },
        },
        // No prefetching: only parts actually pulled by the consumer are counted
        // as delivered, which keeps abort semantics exact.
        { highWaterMark: 0 },
      );
      return { ...result, stream };
    },
  };
}
