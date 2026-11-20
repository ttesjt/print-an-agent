import type { ContextModelMessage } from '@print-an-agent/model-invocation-core';
import type {
  CompletedSessionTurn,
  SessionBranchReference,
  TurnId,
} from '../../contracts/index.js';

export interface SessionCompactionSource extends SessionBranchReference {
  readonly expectedRevision: number;
  readonly previousContext?: ContextModelMessage;
  readonly turns: readonly CompletedSessionTurn[];
  readonly throughTurnId: TurnId;
  readonly sourceCharacters: number;
}
