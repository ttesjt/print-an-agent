import {
  ModelInvocationError,
  type ModelInteractionEvent,
} from '@print-an-agent/model-invocation-core';

interface InteractionBudgetContext {
  readonly state: { outputCharacterCount?: number };
  readonly resources: {
    readonly policy: {
      readonly maxReasoningCharacters: number;
      readonly maxOutputCharacters: number;
    };
  };
}

/** Accounting precedes replaceable delivery Steps, including explicitly skipped presentation. */
export function createInteractionEventAccounting(
  context: InteractionBudgetContext
): (event: ModelInteractionEvent) => void {
  let reasoningCharacters = 0;
  return (event) => {
    if (event.type === 'reasoning-delta') {
      reasoningCharacters += event.delta.length;
      if (reasoningCharacters > context.resources.policy.maxReasoningCharacters) {
        throw new ModelInvocationError(
          'MODEL_REASONING_LIMIT_EXCEEDED',
          'Request interaction reasoning exceeded its character budget.'
        );
      }
    }
    if (event.type === 'text-delta')
      context.state.outputCharacterCount =
        (context.state.outputCharacterCount ?? 0) + event.delta.length;
    const characters =
      event.type === 'assistant-complete'
        ? event.message.text.length
        : (context.state.outputCharacterCount ?? 0);
    if (characters > context.resources.policy.maxOutputCharacters) {
      throw new ModelInvocationError(
        'MODEL_OUTPUT_LIMIT_EXCEEDED',
        'Request interaction output exceeded its character budget.'
      );
    }
  };
}
