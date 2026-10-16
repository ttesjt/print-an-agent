import { defineModelInteractionEvent } from './interaction-event.js';
import { ModelInvocationError } from './errors.js';
import type { ModelGenerationEvent } from './types.js';

export function defineModelGenerationEvent(input: unknown): ModelGenerationEvent {
  const event = defineModelInteractionEvent(input);
  if (
    event.type === 'text-delta' ||
    event.type === 'reasoning-delta' ||
    event.type === 'assistant-complete'
  ) {
    return event;
  }
  throw new ModelInvocationError(
    'MODEL_RUNTIME_PROTOCOL_INVALID',
    'Generation cannot emit interaction lifecycle or tool execution events.'
  );
}
