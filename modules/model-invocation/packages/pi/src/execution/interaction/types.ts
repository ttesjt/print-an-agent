import type { AssistantMessage } from '@earendil-works/pi-ai';
import type {
  AssistantModelMessage,
  ModelInvocationError,
} from '@print-an-agent/model-invocation-core';

export interface PiToolAdapterState {
  readonly attemptedCallIds: Set<string>;
  terminalFailure?: Readonly<{ cause: unknown }>;
}

export interface PiInteractionState {
  outputCharacters: number;
  modelTurns: number;
  turnTextDeltas: string[];
  readonly toolAdapter: PiToolAdapterState;
  completedMessage?: AssistantModelMessage;
  terminalFailure?: AssistantMessage;
  limitFailure?: ModelInvocationError;
  modelTurnFailure?: ModelInvocationError;
  eventSinkFailure?: Error;
}
