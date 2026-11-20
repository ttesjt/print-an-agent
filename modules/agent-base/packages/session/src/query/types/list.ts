import type { AgentId, parseAgentId } from '@print-an-agent/base-identity';
import type { SessionId } from '../../contracts/index.js';
import type { SessionSummary } from './inspection.js';

export interface SessionListCursor {
  readonly updatedAt: number;
  readonly sessionId: SessionId;
}

export interface ListSessionsInput {
  readonly agentId: AgentId;
  readonly cursor?: Readonly<{ readonly updatedAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface SessionListPage {
  readonly records: readonly SessionSummary[];
  readonly nextCursor?: SessionListCursor;
}

export interface NormalizedListSessionsInput {
  readonly agentId: ReturnType<typeof parseAgentId>;
  readonly cursor?: SessionListCursor;
  readonly limit: number;
}
