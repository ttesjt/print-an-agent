import type {
  AssistantModelMessage,
  UserModelMessage,
} from '@print-an-agent/model-invocation-core';
import type { ResolvedSessionReference, SessionReference, TurnId } from '../contracts/index.js';
import type { SessionWriteAuthority } from '../lifecycle/index.js';

export interface BeginSessionTurnRequest extends ResolvedSessionReference, SessionWriteAuthority {
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
}

export interface CompleteSessionTurnRequest extends SessionReference, SessionWriteAuthority {
  readonly turnId: TurnId;
  readonly assistantMessage: AssistantModelMessage;
}

export interface FailSessionTurnRequest extends SessionReference, SessionWriteAuthority {
  readonly turnId: TurnId;
  readonly failureCode: string;
}
