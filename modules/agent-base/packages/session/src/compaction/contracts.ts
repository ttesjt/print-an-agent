import type { ContextModelMessage, ModelMessage } from '@ta-agent/base-model';
import type { SessionWriteAuthority } from '../lifecycle/execution.js';
import type {
  CompletedSessionTurn,
  InspectableSessionPort,
  SessionBranchId,
  SessionBranchReference,
  TurnId,
} from '../types.js';

export interface SessionCompactionPolicy {
  readonly minimumCompletedTurns: number;
  readonly retainRecentTurns: number;
  readonly maxSourceTurns: number;
  readonly maxSourceCharacters: number;
  readonly maxContextCharacters: number;
  readonly timeoutMilliseconds: number;
}

export interface SessionCompaction extends SessionBranchReference {
  readonly revision: number;
  readonly throughTurnId: TurnId;
  readonly context: ContextModelMessage;
}

export interface SessionContextSnapshot extends SessionBranchReference {
  readonly compaction?: SessionCompaction;
  readonly messages: readonly ModelMessage[];
}

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

export type CompactableSessionPort = InspectableSessionPort & SessionCompactionPort;

export interface SessionCompactionSource extends SessionBranchReference {
  readonly expectedRevision: number;
  readonly previousContext?: ContextModelMessage;
  readonly turns: readonly CompletedSessionTurn[];
  readonly throughTurnId: TurnId;
  readonly sourceCharacters: number;
}

export interface CompactSessionInput {
  readonly sessionId: string;
  readonly branchId?: string;
}

export type SessionCompactionSkipReason = 'not-needed';

export type SessionCompactionOutcome =
  | Readonly<{
      status: 'skipped';
      sessionId: string;
      branchId: SessionBranchId;
      reason: SessionCompactionSkipReason;
    }>
  | Readonly<{
      status: 'compacted';
      sessionId: string;
      branchId: SessionBranchId;
      revision: number;
      throughTurnId: TurnId;
      compactedTurnCount: number;
    }>;
