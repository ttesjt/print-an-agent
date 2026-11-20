import type { parseAgentId } from '@print-an-agent/base-identity';
import type {
  parseSessionId,
  parseTurnId,
  SessionReference,
  SessionTurn,
  TurnId,
} from '../../contracts/index.js';

export interface ListSessionTurnsInput extends SessionReference {
  /** Exclusive cursor. Results continue with turns created before this exact durable Turn. */
  readonly beforeTurnId?: string;
  readonly limit?: number;
}

export interface SessionTurnPage {
  /** Newest-first durable ledger entries across every branch in the Session. */
  readonly records: readonly SessionTurn[];
  readonly nextCursor?: TurnId;
}

export interface NormalizedListSessionTurnsInput {
  readonly agentId: ReturnType<typeof parseAgentId>;
  readonly sessionId: ReturnType<typeof parseSessionId>;
  readonly beforeTurnId?: ReturnType<typeof parseTurnId>;
  readonly limit: number;
}
