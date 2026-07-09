// SPDX-License-Identifier: Apache-2.0

/**
 * Shared plumbing for the SDK wrapper packages.
 *
 * Wraps an async-iterable SDK stream so every yielded value is observed and a
 * finalizer runs exactly once when iteration stops — on completion, error, abort,
 * or an early `break` (PRD A4: hash what was actually delivered). Values pass
 * through unmodified (PRD A3). The stream is proxied so SDK-specific properties
 * and methods remain available; methods are bound to the underlying stream to
 * stay compatible with classes using private fields.
 *
 * Consumers that bypass async iteration (e.g. OpenAI's `stream.tee()`) bypass
 * observation too — the wrapper never blocks them.
 */
export interface InstrumentHooks<T> {
  onValue: (value: T) => void;
  /** Runs exactly once after the last delivered value. */
  onDone: () => void;
}

export function instrumentAsyncIterable<S extends object, T>(
  stream: S,
  hooks: InstrumentHooks<T>,
): S {
  let finalized = false;
  const finalize = (): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    hooks.onDone();
  };

  return new Proxy(stream, {
    get(target, prop) {
      if (prop === Symbol.asyncIterator) {
        return (): AsyncIterator<T> => {
          const source = (target as unknown as AsyncIterable<T>)[Symbol.asyncIterator]();
          return {
            async next(...args: [] | [undefined]): Promise<IteratorResult<T>> {
              let result: IteratorResult<T>;
              try {
                result = await source.next(...args);
              } catch (err) {
                // Stream error or abort: record what was delivered up to this point.
                finalize();
                throw err;
              }
              if (result.done) {
                finalize();
              } else {
                hooks.onValue(result.value);
              }
              return result;
            },
            async return(value?: unknown): Promise<IteratorResult<T>> {
              // Consumer stopped early (break / abort): record the partial output.
              finalize();
              if (source.return) {
                return source.return(value);
              }
              return { done: true, value: value as T };
            },
            async throw(err?: unknown): Promise<IteratorResult<T>> {
              finalize();
              if (source.throw) {
                return source.throw(err);
              }
              throw err;
            },
          };
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function"
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
}
