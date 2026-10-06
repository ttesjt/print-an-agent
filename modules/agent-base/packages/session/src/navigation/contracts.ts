import type { AgentId } from '@ta-agent/base-identity';
import type {
  InspectableSessionPort,
  SessionBranchId,
  SessionNavigationSnapshot,
  SessionReference,
  TurnId,
} from '../types.js';
import type { SessionCompactionPort } from '../compaction/contracts.js';
import type { SessionWriteAuthority } from '../lifecycle/execution.js';

export type SessionNavigationOperation = 'inspect' | 'select' | 'fork' | 'rewind';

export type NavigateSessionInput =
  | Readonly<{ sessionId: string; operation: 'inspect' }>
  | Readonly<{
      sessionId: string;
      operation: 'select';
      branchId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      sessionId: string;
      operation: 'fork';
      sourceBranchId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>
  | Readonly<{
      sessionId: string;
      operation: 'rewind';
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>;

export type ValidatedSessionNavigationCommand =
  | Readonly<{ operation: 'inspect' }>
  | Readonly<{
      operation: 'select';
      branchId: SessionBranchId;
      expectedRevision: number;
    }>
  | Readonly<{
      operation: 'fork';
      sourceBranchId: SessionBranchId;
      throughTurnId: TurnId;
      newBranchId?: SessionBranchId;
      expectedRevision: number;
    }>
  | Readonly<{
      operation: 'rewind';
      throughTurnId: TurnId;
      newBranchId?: SessionBranchId;
      expectedRevision: number;
    }>;

export type MutatingSessionNavigationCommand = Exclude<
  ValidatedSessionNavigationCommand,
  Readonly<{ operation: 'inspect' }>
>;

export interface ApplySessionNavigationRequest extends SessionReference, SessionWriteAuthority {
  readonly command: MutatingSessionNavigationCommand;
}

export interface AppliedSessionNavigation {
  readonly operation: Exclude<SessionNavigationOperation, 'inspect'>;
  readonly affectedBranchId: SessionBranchId;
  readonly navigation: SessionNavigationSnapshot;
}

export type SessionNavigationOutcome =
  | Readonly<{
      status: 'inspected';
      navigation: SessionNavigationSnapshot;
    }>
  | Readonly<{
      status: 'selected';
      sessionId: string;
      selectedBranchId: SessionBranchId;
      affectedBranchId: SessionBranchId;
      revision: number;
    }>
  | Readonly<{
      status: 'forked';
      sessionId: string;
      selectedBranchId: SessionBranchId;
      affectedBranchId: SessionBranchId;
      revision: number;
    }>
  | Readonly<{
      status: 'rewound';
      sessionId: string;
      selectedBranchId: SessionBranchId;
      affectedBranchId: SessionBranchId;
      revision: number;
    }>;

export interface SessionNavigationPort {
  applyNavigation(request: ApplySessionNavigationRequest): Promise<AppliedSessionNavigation>;
}

/** Minimal storage authority required by the complete navigation coordinator. */
export type SessionNavigationCoordinatorPort = Pick<InspectableSessionPort, 'inspect'> &
  SessionNavigationPort;

export type NavigableSessionPort = InspectableSessionPort & SessionNavigationPort;
export type NavigableCompactableSessionPort = NavigableSessionPort & SessionCompactionPort;

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
