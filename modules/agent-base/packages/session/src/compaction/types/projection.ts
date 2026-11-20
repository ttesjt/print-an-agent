import type { ContextModelMessage, ModelMessage } from '@print-an-agent/model-invocation-core';
import type { SessionBranchReference, TurnId } from '../../contracts/index.js';

export interface SessionCompaction extends SessionBranchReference {
  readonly revision: number;
  readonly throughTurnId: TurnId;
  readonly context: ContextModelMessage;
}

export interface SessionContextSnapshot extends SessionBranchReference {
  readonly compaction?: SessionCompaction;
  readonly messages: readonly ModelMessage[];
}
