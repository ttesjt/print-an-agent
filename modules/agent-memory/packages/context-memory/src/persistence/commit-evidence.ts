import { ContextMemoryError } from '../errors.js';
import type { CommitStatus } from '../types/receipt.js';

/** Filter evidence before ranking it; unrelated outer receipts must not hide matching causes. */
export function findContextMemoryCommit(
  error: unknown,
  accept: (commit: CommitStatus) => boolean = () => true
): CommitStatus | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  let result: CommitStatus | undefined;
  while (pending.length !== 0) {
    const cause = pending.pop();
    if (!(cause instanceof Error) || seen.has(cause)) continue;
    seen.add(cause);
    const own = cause instanceof ContextMemoryError ? cause.commit : undefined;
    if (own !== undefined && accept(own)) {
      if (own.status === 'committed') return own;
      if (result === undefined || own.status === 'unknown') result = own;
    }
    const children: unknown[] =
      cause instanceof AggregateError
        ? [...(cause.errors as unknown[]), cause.cause]
        : [cause.cause];
    pending.push(...children.reverse());
  }
  return result;
}
