import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import type { SessionCompactionPort, SessionContextSnapshot } from '../compaction/index.js';
import type {
  ActiveSessionTurn,
  CompletedSessionTurn,
  LoadSessionHistoryRequest,
  ResolveSessionRequest,
  ResolvedSessionReference,
  SessionInspectionPort,
  SessionTurn,
} from '../contracts/index.js';
import type { SessionMetadataPort } from '../metadata/index.js';
import type { SessionNavigationPort } from '../navigation/index.js';
import type { SessionQueryPort } from '../query/index.js';
import type {
  BeginSessionTurnRequest,
  CompleteSessionTurnRequest,
  FailSessionTurnRequest,
} from '../turns/index.js';

/** Package-level combinations. Features consume narrower contracts, never this aggregate. */
export interface SessionPort {
  /** A supplied missing ID fails with SESSION_NOT_FOUND; it must never implicitly create. */
  resolve(request: ResolveSessionRequest): Promise<ResolvedSessionReference>;
  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn>;
  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]>;
  loadContext(request: LoadSessionHistoryRequest): Promise<SessionContextSnapshot>;
  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn>;
  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn>;
}

export interface InspectableSessionPort extends SessionPort, SessionInspectionPort {}
export type CompactableSessionPort = InspectableSessionPort & SessionCompactionPort;
export type NavigableSessionPort = InspectableSessionPort & SessionNavigationPort;
export type NavigableCompactableSessionPort = NavigableSessionPort & SessionCompactionPort;

export type ManageableSessionQueryPort = SessionQueryPort & SessionMetadataPort;
