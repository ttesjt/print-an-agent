import type { JsonValue } from '@print-an-agent/workbench-domain';
import { OutputInvocationCapabilityError } from './errors.js';

/** Forward lifecycle independently of pulls; only the control plane classifies invocation errors. */
export function wrapInvocationStream(
  stream: AsyncIterable<JsonValue>,
  profileId: string,
  outputId: string
): AsyncIterable<JsonValue> {
  const failure = (cause: unknown) =>
    cause instanceof Error && cause.name === 'AbortError'
      ? cause
      : new OutputInvocationCapabilityError(profileId, outputId, { cause });
  return Object.freeze({
    [Symbol.asyncIterator](): AsyncIterator<JsonValue> {
      const iterator = stream[Symbol.asyncIterator]();
      let ended = false;
      let closePromise: Promise<IteratorResult<JsonValue>> | undefined;
      const done = (): IteratorResult<JsonValue> => ({ done: true, value: undefined });
      const close = (): Promise<IteratorResult<JsonValue>> => {
        if (closePromise !== undefined) return closePromise;
        if (ended) return Promise.resolve(done());
        ended = true;
        closePromise = Promise.resolve().then(async () => {
          try {
            await iterator.return?.();
          } catch (cause: unknown) {
            throw failure(cause);
          }
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
            if (result.done === true) ended = true;
            return result;
          } catch (cause: unknown) {
            let error: unknown = cause;
            try {
              await close();
            } catch (cleanupCause: unknown) {
              error = new AggregateError(
                [cause, cleanupCause],
                'Output invocation and stream cleanup failed.'
              );
            }
            throw failure(error);
          }
        },
        return: close,
      };
    },
  });
}
