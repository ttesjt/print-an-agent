import type { SessionReference } from '../../contracts/index.js';
import type { SessionInspection } from './inspection.js';
import type { ListSessionsInput, SessionListPage } from './list.js';
import type { ListSessionTurnsInput, SessionTurnPage } from './turns.js';

export interface SessionQueryPort {
  listSessions(input: ListSessionsInput): Promise<SessionListPage>;
  inspectSession(reference: SessionReference): Promise<SessionInspection | undefined>;
  listSessionTurns(input: ListSessionTurnsInput): Promise<SessionTurnPage | undefined>;
}
