import type {
  ModelInteractionEvent,
  ModelInteractionEventSink,
  ModelInteractionResult,
} from '@print-an-agent/model-invocation-core';

/** Shared interaction state; currentEvent is available only during its awaited dispatch. */
export interface RequestInteractionState {
  readonly signal: AbortSignal;
  readonly emit: ModelInteractionEventSink;
  /** Stop ingress/cancel delivery without releasing already accepted work. */
  readonly stop: (cause: unknown) => unknown;
  readonly currentEvent: ModelInteractionEvent | undefined;
  result: ModelInteractionResult | undefined;
}

import type { ActorInteractionRequest } from '@print-an-agent/model-invocation-core';
export interface InteractionInvocationContext {
  readonly signal: AbortSignal;
  readonly state: { modelRequest?: ActorInteractionRequest; interaction?: RequestInteractionState };
}
