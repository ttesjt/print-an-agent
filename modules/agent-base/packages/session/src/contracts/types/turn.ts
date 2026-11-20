import type {
  AssistantModelMessage,
  UserModelMessage,
} from '@print-an-agent/model-invocation-core';
import type { SessionBranchId, TurnId } from './identifiers.js';

interface SessionTurnLineage {
  readonly branchId: SessionBranchId;
  readonly parentTurnId?: TurnId;
}

export interface ActiveSessionTurn {
  readonly status: 'active';
  readonly turnId: TurnId;
  readonly branchId: SessionBranchId;
  readonly parentTurnId?: TurnId;
  readonly userMessage: UserModelMessage;
}

export interface CompletedSessionTurn extends SessionTurnLineage {
  readonly status: 'completed';
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
  readonly assistantMessage: AssistantModelMessage;
}

export interface FailedSessionTurn extends SessionTurnLineage {
  readonly status: 'failed';
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
  readonly failureCode: string;
}

export type SessionTurn = ActiveSessionTurn | CompletedSessionTurn | FailedSessionTurn;
