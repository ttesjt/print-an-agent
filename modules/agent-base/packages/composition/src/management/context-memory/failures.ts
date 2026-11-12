import { AgentSessionError } from '@print-an-agent/base-session';
import { ContextMemoryError } from '@print-an-agent/context-memory';

/** Cleanup is independent of cancellation/commit; inspect the entire finite error tree. */
export function hasSessionMemoryCleanupFailure(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  while (pending.length) {
    const current = pending.pop();
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    if (
      (current instanceof ContextMemoryError && current.code === 'CLEANUP_FAILED') ||
      (current instanceof AgentSessionError && current.code === 'SESSION_MEMORY_CLEANUP_FAILED')
    )
      return true;
    pending.push(current.cause);
    if (current instanceof AggregateError) pending.push(...(current.errors as unknown[]));
  }
  return false;
}
