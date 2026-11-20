import type { AgentId, parseAgentId } from '@print-an-agent/base-identity';
import type { SessionId, SessionReference } from '../../contracts/index.js';
import type {
  ListSessionsInput,
  SessionListPage,
  SessionQueryPort,
  SessionSummary,
} from '../../query/index.js';
import type { SessionExecutionFence } from '../execution/index.js';
import type { SessionLifecycleSnapshot } from '../state/index.js';

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

export interface NormalizedListRetiredSessionsInput {
  readonly agentId: ReturnType<typeof parseAgentId>;
  readonly limit: number;
  readonly cursor?: RetiredSessionListCursor;
}
