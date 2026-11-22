import type { CommitEvidence } from '../types/publication.js';
import { RetrievalMemoryError } from '../errors.js';

/** Native Workflow may aggregate independent hook/protocol failures; inspect facts without discarding them. */
export function findRetrievalCommit(
  error: unknown,
  accept: (commit: CommitEvidence) => boolean = () => true
): CommitEvidence | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  let result: CommitEvidence | undefined;
  while (pending.length !== 0) {
    const cause = pending.pop();
    if (!(cause instanceof Error) || seen.has(cause)) continue;
    seen.add(cause);
    const own = cause instanceof RetrievalMemoryError ? cause.commit : undefined;
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
