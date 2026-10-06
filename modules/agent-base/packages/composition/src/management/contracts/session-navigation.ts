import type {
  SessionBranchId,
  SessionId,
  SessionNavigationCoordinatorPort,
  SessionNavigationOutcome,
  SessionNavigationOperationOptions,
  TurnId,
} from '@ta-agent/base-session';
import type { AgentId } from '@ta-agent/base-identity';
import type { ManagedAgentNamespace } from './namespace.js';

/** The exact out-of-band capability required by the standard Session navigation Service. */
export interface SessionNavigationPorts {
  readonly session: SessionNavigationCoordinatorPort;
}

/** Creates product-owned out-of-band Session navigation ports for one Agent namespace. */
export type SessionNavigationPortFactory<TNamespaceHandle, TSessionNavigationPorts> = (
  namespace: ManagedAgentNamespace<TNamespaceHandle>
) => TSessionNavigationPorts | Promise<TSessionNavigationPorts>;

/** Optional typed capability; it neither requires nor implies Session management. */
export interface SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts> {
  readonly sessionNavigation: Readonly<{
    createPorts: SessionNavigationPortFactory<TNamespaceHandle, TSessionNavigationPorts>;
  }>;
}

export interface InspectManagedSessionNavigationInput {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface SelectManagedSessionBranchInput extends InspectManagedSessionNavigationInput {
  readonly branchId: SessionBranchId;
  readonly expectedRevision: number;
}

export interface ForkManagedSessionBranchInput extends InspectManagedSessionNavigationInput {
  readonly sourceBranchId: SessionBranchId;
  readonly throughTurnId: TurnId;
  readonly newBranchId?: SessionBranchId;
  readonly expectedRevision: number;
}

export interface RewindManagedSessionBranchInput extends InspectManagedSessionNavigationInput {
  readonly throughTurnId: TurnId;
  readonly newBranchId?: SessionBranchId;
  readonly expectedRevision: number;
}

export type SessionNavigationInspectionOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'inspected' }>
>;
export type SessionBranchSelectionOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'selected' }>
>;
export type SessionBranchForkOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'forked' }>
>;
export type SessionBranchRewindOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'rewound' }>
>;

/** Out-of-band Session branch navigation without Agent runtime materialization. */
export interface SessionNavigationService {
  inspect(
    input: InspectManagedSessionNavigationInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionNavigationInspectionOutcome>;
  select(
    input: SelectManagedSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchSelectionOutcome>;
  fork(
    input: ForkManagedSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchForkOutcome>;
  rewind(
    input: RewindManagedSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchRewindOutcome>;
}
