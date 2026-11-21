import type { ModelMessage, ResolvedActor } from '@print-an-agent/model-invocation-core';
import type { RequestInteractionState } from '../../interaction/index.js';
import type { SessionlessRequestInput, SessionlessValidatedRequest } from './input.js';
import type { SessionlessOutputOutcome } from './output.js';
export interface SessionlessState {
  readonly input: SessionlessRequestInput;
  request?: SessionlessValidatedRequest;
  outputOutcome?: SessionlessOutputOutcome;
  actor?: ResolvedActor;
  instructions?: string;
  externalContext?: readonly ModelMessage[];
  interaction?: RequestInteractionState;
}
