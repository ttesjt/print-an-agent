import type {
  ActorInteractionRequest,
  InteractionCapability,
} from '@ta-agent/model-invocation-core';
import { composeExecutionSignal } from '@ta-agent/workflow-core';
import { requireValue } from '../preparation/state-value.js';
import type { RequestInteractionState } from './state.js';
import { InteractionToolExecution } from './tool-execution.js';

export interface InteractionInvocationContext {
  readonly signal: AbortSignal;
  readonly state: { modelRequest?: ActorInteractionRequest; interaction?: RequestInteractionState };
}

/** Both request profiles retain the same invocation signal and borrowed-tool ownership semantics. */
export async function invokeRequestInteraction(
  context: InteractionInvocationContext,
  target: InteractionCapability
): Promise<void> {
  const interaction = requireValue(context.state.interaction, 'interaction');
  const request = requireValue(context.state.modelRequest, 'modelRequest');
  const tools = new InteractionToolExecution(
    request.tools,
    composeExecutionSignal([context.signal, interaction.signal]),
    // A cancelled Step may already own a stronger executor failure. Do not lock its resulting
    // Tool cancellation into the parent delivery before Workflow has joined/attributed that failure.
    (cause) => (context.signal.aborted ? cause : interaction.stop(cause))
  );
  try {
    const result = await target.interact({
      ...request,
      tools: tools.port,
      signal: tools.signal,
      emit: async (event) => {
        // Session-aware consumers may commit at this event. Join Tools before publishing it.
        if (event.type === 'assistant-complete') await tools.finish();
        await interaction.emit(event);
      },
    });
    await tools.finish();
    interaction.result = result;
  } catch (cause: unknown) {
    const failure = tools.stop(cause);
    await tools.drain();
    throw failure;
  }
}
