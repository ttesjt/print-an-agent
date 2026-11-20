import type { SessionInspectionPort, SessionReference } from '../../contracts/index.js';
import type { SessionWriteAuthority } from '../../lifecycle/index.js';
import type { MutatingSessionNavigationCommand } from './command.js';
import type { AppliedSessionNavigation } from './outcome.js';

export interface ApplySessionNavigationRequest extends SessionReference, SessionWriteAuthority {
  readonly command: MutatingSessionNavigationCommand;
  /** Per-call cancellation, never persisted as part of the command. */
  readonly signal?: AbortSignal;
}

export interface SessionNavigationPort {
  applyNavigation(request: ApplySessionNavigationRequest): Promise<AppliedSessionNavigation>;
}

/** Minimal storage authority required by the complete navigation coordinator. */
export type SessionNavigationCoordinatorPort = SessionInspectionPort & SessionNavigationPort;
