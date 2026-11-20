import type { ExecutionSignalSources } from './types.js';

/**
 * Produces the one effective downstream signal for an execution boundary.
 * Source order is the deterministic precedence when multiple inputs are already aborted.
 * The effective reason is cancellation evidence, not the boundary's authoritative terminal error.
 */
export function composeExecutionSignal(sources: ExecutionSignalSources): AbortSignal {
  const uniqueSources: AbortSignal[] = [];
  for (const source of sources) {
    if (!uniqueSources.includes(source)) uniqueSources.push(source);
  }
  return uniqueSources.length === 1 ? uniqueSources[0]! : AbortSignal.any(uniqueSources);
}
