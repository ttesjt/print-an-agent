import type { ReasoningDeltaEvent, TextDeltaEvent } from '@print-an-agent/model-invocation-core';

export type OutputTextDeltaEvent = TextDeltaEvent;

export type OutputReasoningDeltaEvent = ReasoningDeltaEvent;

export type OutputStreamEvent = OutputTextDeltaEvent | OutputReasoningDeltaEvent;

export interface OutputFailure {
  readonly code: string;
  readonly message: string;
}

import type { ModelInteractionEvent } from '@print-an-agent/model-invocation-core';
export interface DeltaDeliveryContext {
  readonly state: {
    readonly interaction?: { readonly currentEvent: ModelInteractionEvent | undefined };
    readonly request?: {
      readonly outputSink?: { readonly write: (event: OutputStreamEvent) => Promise<void> };
    };
  };
}
