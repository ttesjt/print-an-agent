import type { AgentId } from '@print-an-agent/base-identity';
import type {
  AssistantModelMessage,
  ModelMessage,
  UserModelMessage,
} from '@print-an-agent/model-invocation-core';
import type { SessionContextSnapshot } from './compaction/contracts.js';
import type { SessionWriteAuthority } from './lifecycle/execution.js';

declare const sessionIdBrand: unique symbol;
declare const sessionBranchIdBrand: unique symbol;
declare const turnIdBrand: unique symbol;

/** Adapter-generated opaque identity: immutable and never reassigned, including after deletion. */
export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' };
export type SessionBranchId = string & {
  readonly [sessionBranchIdBrand]: 'SessionBranchId';
};
export type TurnId = string & { readonly [turnIdBrand]: 'TurnId' };

export interface SessionReference {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface SessionBranchReference extends SessionReference {
  readonly branchId: SessionBranchId;
}

export interface ResolvedSessionReference extends SessionBranchReference {
  readonly navigationRevision: number;
}

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

export interface SessionBranchSnapshot {
  readonly branchId: SessionBranchId;
  readonly parentBranchId?: SessionBranchId;
  readonly forkedFromTurnId?: TurnId;
  readonly headTurnId?: TurnId;
  readonly createdAt: number;
}

export interface SessionNavigationSnapshot extends SessionReference {
  readonly revision: number;
  readonly selectedBranchId: SessionBranchId;
  readonly branches: readonly SessionBranchSnapshot[];
}

export interface SessionSnapshot extends SessionReference {
  readonly navigation: SessionNavigationSnapshot;
  readonly turns: readonly SessionTurn[];
}

export interface ResolveSessionRequest {
  readonly agentId: AgentId;
  /** Open an existing Session only. Omit to create with a fresh adapter-generated ID. */
  readonly sessionId?: string;
}

export interface BeginSessionTurnRequest extends ResolvedSessionReference, SessionWriteAuthority {
  readonly turnId: TurnId;
  readonly userMessage: UserModelMessage;
}

export interface LoadSessionHistoryRequest extends SessionReference {
  readonly beforeTurnId: TurnId;
}

export interface CompleteSessionTurnRequest extends SessionReference, SessionWriteAuthority {
  readonly turnId: TurnId;
  readonly assistantMessage: AssistantModelMessage;
}

export interface FailSessionTurnRequest extends SessionReference, SessionWriteAuthority {
  readonly turnId: TurnId;
  readonly failureCode: string;
}

export interface SessionPort {
  /** A supplied missing ID fails with SESSION_NOT_FOUND; it must never implicitly create. */
  resolve(request: ResolveSessionRequest): Promise<ResolvedSessionReference>;
  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn>;
  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]>;
  loadContext(request: LoadSessionHistoryRequest): Promise<SessionContextSnapshot>;
  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn>;
  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn>;
}

export interface InspectableSessionPort extends SessionPort {
  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined>;
}
