import { assertMemoryNotAborted } from '../../../errors.js';
import { modelMemorySignal } from './signal.js';
import type { ModelMemoryContext } from '../types/workflow.js';

/** A resolved Promise only yields microtasks; retries must also admit timers and external aborts. */
export async function yieldMemoryRetry(context: ModelMemoryContext): Promise<void> {
  assertMemoryNotAborted(modelMemorySignal(context));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assertMemoryNotAborted(modelMemorySignal(context));
}
