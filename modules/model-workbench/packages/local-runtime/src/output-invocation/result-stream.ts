import type { JsonValue } from '@print-an-agent/workbench-domain';
import { LocalOutputInvocationMessageKind } from '../foundation/constants.js';
import { LocalOutputInvocationError } from '../foundation/errors.js';
import { parseLocalOutputInvocationMessage } from './protocol.js';

export interface InvocationStreamProcess {
  requireSuccess(): Promise<void>;
  stop(): Promise<void>;
}

export async function closeInvocationReader(
  lines: AsyncIterator<string>,
  process: InvocationStreamProcess
): Promise<void> {
  // Start stop first, but settle both cleanups together: reader.return() may be queued
  // behind next(), while child.close may itself wait for a paused stdout reader to close.
  const results = await Promise.allSettled([
    Promise.resolve().then(() => process.stop()),
    Promise.resolve().then(() => lines.return?.()),
  ]);
  const failures: unknown[] = [];
  for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Local process and reader cleanup failed.');
}

/** The process is already running; return must stop it even if next has never been called. */
export function createResultStream(
  lines: AsyncIterator<string>,
  process: InvocationStreamProcess
): AsyncIterable<JsonValue> {
  let ended = false;
  let closePromise: Promise<IteratorResult<JsonValue>> | undefined;
  const done = (): IteratorResult<JsonValue> => ({ done: true, value: undefined });
  const close = (): Promise<IteratorResult<JsonValue>> => {
    if (closePromise !== undefined) return closePromise;
    if (ended) return Promise.resolve(done());
    ended = true;
    closePromise = Promise.resolve().then(async () => {
      await closeInvocationReader(lines, process);
      return done();
    });
    return closePromise;
  };
  const iterator: AsyncIterator<JsonValue> = {
    next: async () => {
      if (ended) return done();
      try {
        const result = await lines.next();
        if (ended) return done();
        if (result.done === true) {
          await process.requireSuccess();
          ended = true;
          return done();
        }
        const message = parseLocalOutputInvocationMessage(result.value);
        if (message.kind !== LocalOutputInvocationMessageKind.Chunk) {
          throw new LocalOutputInvocationError(
            'A streaming local Output Invocation may contain only chunk messages.'
          );
        }
        return { done: false, value: message.result };
      } catch (cause: unknown) {
        const failure =
          (cause instanceof Error && cause.name === 'AbortError') ||
          cause instanceof LocalOutputInvocationError
            ? cause
            : new LocalOutputInvocationError('The local Output Invocation stream failed.', {
                cause,
              });
        try {
          await close();
        } catch (cleanupCause: unknown) {
          throw new AggregateError([failure, cleanupCause], 'Local invocation and cleanup failed.');
        }
        throw failure;
      }
    },
    return: close,
  };
  return Object.freeze({ [Symbol.asyncIterator]: () => iterator });
}
