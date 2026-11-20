import type { AgentId } from '@print-an-agent/base-identity';
import type { NavigateSessionInput } from './command.js';
import type { SessionNavigationCoordinatorPort } from './ports.js';

/** Complete domain execution input; storage remains injected through the narrow Session port. */
export interface SessionNavigationCoordinatorRequest {
  readonly agentId: AgentId;
  readonly navigation: NavigateSessionInput;
  readonly session: SessionNavigationCoordinatorPort;
}

/** Per-call execution behavior; cancellation is not part of the persisted navigation command. */
export interface SessionNavigationOperationOptions {
  readonly signal?: AbortSignal;
}
