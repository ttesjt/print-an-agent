import type { AgentId } from '@ta-agent/base-identity';
import type {
  ListSessionsInput,
  SessionListPage,
  SessionQueryPort,
  SessionSummary,
} from '../query/contracts.js';
import type { SessionId, SessionReference } from '../types.js';
import type { SessionExecutionFence } from './execution.js';

export type SessionLifecycleState =
  | Readonly<{ status: 'active' }>
  | Readonly<{ status: 'retired'; retiredAt: number }>;

export type SessionLifecycleSnapshot = SessionReference &
  SessionLifecycleState &
  Readonly<{ metadataRevision: number; metadataUpdatedAt: number }>;

/** Bounded listing metadata; does not require an execution-occupancy lookup. */
export type SessionLifecycleSummary = SessionSummary & SessionLifecycleSnapshot;

export type SessionLifecycleInspection = SessionLifecycleSummary &
  Readonly<{ execution: SessionExecutionFence }>;

export interface SessionLifecycleListPage extends SessionListPage {
  readonly records: readonly (SessionLifecycleSummary & { readonly status: 'active' })[];
}

export interface RetiredSessionListCursor {
  readonly retiredAt: number;
  readonly sessionId: SessionId;
}

export interface ListRetiredSessionsInput {
  readonly agentId: AgentId;
  readonly cursor?: Readonly<{ retiredAt: number; sessionId: string }>;
  readonly limit?: number;
}

export interface RetiredSessionListPage {
  readonly records: readonly (SessionLifecycleSummary & { readonly status: 'retired' })[];
  readonly nextCursor?: RetiredSessionListCursor;
}

/** Read capability only; inspection/history remain available for retired Sessions. */
export interface SessionLifecycleQueryPort extends SessionQueryPort {
  /** Active Sessions only, using the existing activity ordering. */
  listSessions(input: ListSessionsInput): Promise<SessionLifecycleListPage>;
  inspectSession(reference: SessionReference): Promise<SessionLifecycleInspection | undefined>;
  /** retiredAt descending, then Session ID ascending; cursor is exclusive. */
  listRetiredSessions(input: ListRetiredSessionsInput): Promise<RetiredSessionListPage>;
}

/** Also required by lifecycle-aware metadata writes, including rename. */
export interface SessionLifecycleMutationInput extends SessionReference {
  readonly expectedRevision: number;
}

export type RetireSessionInput = SessionLifecycleMutationInput;
export type RestoreSessionInput = SessionLifecycleMutationInput;

/** Adapters check identity, CAS, state and occupancy together with the commit. */
export interface SessionLifecyclePort {
  retireSession(input: RetireSessionInput): Promise<SessionLifecycleSnapshot>;
  restoreSession(input: RestoreSessionInput): Promise<SessionLifecycleSnapshot>;
}

export interface PurgeSessionInput extends SessionLifecycleMutationInput {
  readonly confirmation: 'permanently-delete-session';
}

/**
 * Optional atomic deletion of a retired, idle Session aggregate only.
 * Includes branches, turns, presentation, navigation, compaction and Session-owned execution state.
 * Excludes records owned by other domains. Cross-domain cleanup requires a separate composed
 * capability; this port does not attest it. No partially visible success within the Session scope.
 * The exact reference is absent after success, not a new `purged` record.
 */
export interface SessionPurgePort {
  purgeSession(input: PurgeSessionInput): Promise<void>;
}
