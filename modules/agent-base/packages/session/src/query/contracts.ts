import type { AgentId } from '@print-an-agent/base-identity';
import type {
  SessionBranchId,
  SessionId,
  SessionReference,
  SessionTurn,
  TurnId,
} from '../types.js';

export const DEFAULT_SESSION_QUERY_LIMIT = 50;
export const MAX_SESSION_QUERY_LIMIT = 200;

export interface SessionListCursor {
  readonly updatedAt: number;
  readonly sessionId: SessionId;
}

export interface ListSessionsInput {
  readonly agentId: AgentId;
  readonly cursor?: Readonly<{ readonly updatedAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface ListSessionTurnsInput extends SessionReference {
  /** Exclusive cursor. Results continue with turns created before this exact durable Turn. */
  readonly beforeTurnId?: string;
  readonly limit?: number;
}

export interface SessionSummary extends SessionReference {
  readonly title?: string;
  readonly metadataRevision: number;
  readonly metadataUpdatedAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly selectedBranchId: SessionBranchId;
  readonly navigationRevision: number;
  readonly branchCount: number;
  readonly turnCount: number;
}

export type SessionInspection = SessionSummary;

export interface SessionListPage {
  readonly records: readonly SessionSummary[];
  readonly nextCursor?: SessionListCursor;
}

export interface SessionTurnPage {
  /** Newest-first durable ledger entries across every branch in the Session. */
  readonly records: readonly SessionTurn[];
  readonly nextCursor?: TurnId;
}

export interface SessionQueryPort {
  listSessions(input: ListSessionsInput): Promise<SessionListPage>;
  inspectSession(reference: SessionReference): Promise<SessionInspection | undefined>;
  listSessionTurns(input: ListSessionTurnsInput): Promise<SessionTurnPage | undefined>;
}

export interface RenameSessionInput extends SessionReference {
  readonly title: string;
  readonly expectedRevision: number;
}

export interface SessionMetadataPort {
  renameSession(input: RenameSessionInput): Promise<SessionInspection>;
}

export type ManageableSessionQueryPort = SessionQueryPort & SessionMetadataPort;
