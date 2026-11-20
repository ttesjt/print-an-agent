import type { ContextModelMessage } from '@print-an-agent/model-invocation-core';
import type { SessionBranchReference, TurnId } from '../../contracts/index.js';
import type { SessionWriteAuthority } from '../../lifecycle/index.js';
import type { SessionCompaction } from './projection.js';

export type ReadSessionCompactionRequest = SessionBranchReference;

export interface CommitSessionCompactionRequest
  extends SessionBranchReference, SessionWriteAuthority {
  readonly expectedRevision: number;
  readonly throughTurnId: TurnId;
  readonly context: ContextModelMessage;
}

export interface SessionCompactionPort {
  readCompaction(request: ReadSessionCompactionRequest): Promise<SessionCompaction | undefined>;
  commitCompaction(request: CommitSessionCompactionRequest): Promise<SessionCompaction>;
}
