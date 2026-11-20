import { resolveSessionCompactionCounter } from '../../token-measurement.js';
import type { SessionCompactionWorkflowContext } from '../types.js';

export async function resolveCompactionTokenCounter(
  context: SessionCompactionWorkflowContext
): Promise<void> {
  context.state.tokenCounter = await resolveSessionCompactionCounter(
    context.resources,
    context.signal
  );
}
