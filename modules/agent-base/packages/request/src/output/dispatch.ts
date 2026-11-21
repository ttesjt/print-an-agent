import type { RequestInteractionState } from '../interaction/index.js';
import { requireValue } from '../state-access.js';

/** Generation and Interaction share only their normalized presentation events. */
export async function dispatchRequestDelta(context: {
  readonly state: { readonly interaction?: RequestInteractionState };
  runStep(name: 'deliverTextDelta' | 'deliverReasoningDelta'): Promise<void>;
}): Promise<void> {
  const event = requireValue(context.state.interaction, 'interaction').currentEvent;
  if (event?.type === 'text-delta') await context.runStep('deliverTextDelta');
  else if (event?.type === 'reasoning-delta') await context.runStep('deliverReasoningDelta');
}
