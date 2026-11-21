import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type {
  SessionBranchId,
  SessionCompaction,
  SessionExecutionId,
  SessionExecutionLease,
  SessionId,
  SessionLifecycleState,
  SessionTurn,
  SessionTurnPresentation,
  TurnId,
} from '@print-an-agent/base-session';

export interface StoredMemoryBranch {
  readonly branchId: SessionBranchId;
  readonly parentBranchId?: SessionBranchId;
  readonly forkedFromTurnId?: TurnId;
  readonly createdAt: number;
  headTurnId?: TurnId;
}

export interface StoredMemorySession {
  readonly memoryRecords: Map<string, import('@print-an-agent/base-session').SessionMemoryRecord>;
  lifecycle: SessionLifecycleState;
  executionRevision: number;
  executionState: 'ready' | 'recovering';
  readonly executions: Map<SessionExecutionId, SessionExecutionLease>;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly createdAt: number;
  readonly branches: Map<SessionBranchId, StoredMemoryBranch>;
  readonly turns: SessionTurn[];
  readonly presentations: Map<TurnId, SessionTurnPresentation>;
  readonly compactions: Map<SessionBranchId, SessionCompaction>;
  title?: string;
  metadataRevision: number;
  metadataUpdatedAt: number;
  updatedAt: number;
  selectedBranchId: SessionBranchId;
  navigationRevision: number;
}

/** One Adapter-owned state object; capability helpers borrow these collections. */
export interface MemorySessionState {
  readonly sessions: Map<string, StoredMemorySession>;
  readonly sessionIds: Set<string>;
  readonly createSessionId: () => string;
  readonly createBranchId: () => string;
  readonly clock: () => number;
}
