import type { AgentId } from '@print-an-agent/base-identity';
import type { SessionId, SessionSnapshot } from '../../contracts/index.js';
import type { SessionExecutionLease } from '../../lifecycle/index.js';
import type { NavigateSessionInput, ValidatedSessionNavigationCommand } from '../types/command.js';
import type { AppliedSessionNavigation, SessionNavigationOutcome } from '../types/outcome.js';
import type { SessionNavigationCoordinatorPort } from '../types/ports.js';

export interface SessionNavigationExecutionState {
  readonly agentId: AgentId;
  readonly input: NavigateSessionInput;
  readonly resources: Readonly<{ session: SessionNavigationCoordinatorPort }>;
  sessionId?: SessionId;
  execution?: SessionExecutionLease;
  command?: ValidatedSessionNavigationCommand;
  snapshot?: SessionSnapshot;
}

export interface SessionNavigationCommit {
  readonly applied: AppliedSessionNavigation;
  readonly result: Exclude<SessionNavigationOutcome, Readonly<{ status: 'inspected' }>>;
}
