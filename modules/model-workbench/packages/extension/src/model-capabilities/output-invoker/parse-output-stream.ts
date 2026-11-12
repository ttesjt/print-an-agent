import type { JsonValue } from '@print-an-agent/workbench-domain';

/** Validate lazily, but transfer iterator ownership as soon as a consumer claims the stream. */
export function parseOutputStream(
  stream: AsyncIterable<unknown>,
  parseResult: (value: unknown, path?: string) => JsonValue,
  path: string
): AsyncIterable<JsonValue> {
  return Object.freeze({
    [Symbol.asyncIterator](): AsyncIterator<JsonValue> {
      const iterator = stream[Symbol.asyncIterator]();
      let index = 0;
      let ended = false;
      let closePromise: Promise<IteratorResult<JsonValue>> | undefined;
      const done = (): IteratorResult<JsonValue> => ({ done: true, value: undefined });
      const close = (): Promise<IteratorResult<JsonValue>> => {
        if (closePromise !== undefined) return closePromise;
        if (ended) return Promise.resolve(done());
        ended = true;
        closePromise = Promise.resolve().then(async () => {
          await iterator.return?.();
          return done();
        });
        return closePromise;
      };
      return {
        next: async () => {
          if (ended) return done();
          try {
            const result = await iterator.next();
            if (ended) return done();
            if (result.done === true) {
              ended = true;
              return done();
            }
            const value = parseResult(result.value, `${path}[${String(index)}]`);
            index += 1;
            return { done: false, value };
          } catch (cause: unknown) {
            try {
              await close();
            } catch (cleanupCause: unknown) {
              throw new AggregateError(
                [cause, cleanupCause],
                'Output invocation validation and stream cleanup failed.'
              );
            }
            throw cause;
          }
        },
        // Unlike an async generator, this forwards return even before the first next().
        return: close,
      };
    },
  });
}
