import { ActorError } from './errors.js';
import type { ResolvedActor } from './types/definition.js';
import type {
  CompletionCapability,
  InteractionCapability,
  StreamingCapability,
} from './types/invocation.js';
import type { TokenCounter, TextTokenInput } from '../token-measurement/index.js';

export function requireStreamingCapability<T extends ResolvedActor>(
  actor: T
): T & StreamingCapability {
  if (!hasStreaming(actor)) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${actor.id}" does not support streaming generation.`
    );
  }
  return actor;
}

function hasStreaming<T extends ResolvedActor>(actor: T): actor is T & StreamingCapability {
  return typeof actor.stream === 'function';
}

export function requireCompletionCapability<T extends ResolvedActor>(
  actor: T
): T & CompletionCapability {
  if (!hasCompletion(actor)) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${actor.id}" does not support completion.`
    );
  }
  return actor;
}

function hasCompletion<T extends ResolvedActor>(actor: T): actor is T & CompletionCapability {
  return typeof actor.complete === 'function';
}

export function requireInteractionCapability<T extends ResolvedActor>(
  actor: T
): T & InteractionCapability {
  if (!hasInteraction(actor)) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${actor.id}" does not support interaction.`
    );
  }
  return actor;
}

function hasInteraction<T extends ResolvedActor>(actor: T): actor is T & InteractionCapability {
  return typeof actor.interact === 'function';
}

/** Measurement is optional and independent of the Actor's invocation modes. */
export function requireActorTextTokenCounter(actor: ResolvedActor): TokenCounter<TextTokenInput> {
  if (actor.textTokenCounter === undefined) {
    throw new ActorError(
      'ACTOR_TOKEN_MEASUREMENT_UNAVAILABLE',
      'Actor has no text token counter bound.'
    );
  }
  return actor.textTokenCounter;
}
