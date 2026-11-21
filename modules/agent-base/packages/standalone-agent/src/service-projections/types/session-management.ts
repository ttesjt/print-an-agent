import type { ManagementOperationOptions } from '@print-an-agent/base-composition';
import type {
  RetiredSessionListPage,
  SessionExecutionFence,
  SessionLifecycleInspection,
  SessionLifecycleListPage,
  SessionLifecycleSnapshot,
  SessionTurnPage,
} from '@print-an-agent/base-session';
import type { StandaloneSessionReferenceInput } from './session-reference.js';

/** String/JSON boundary projection of the generic, branded Session management Service. */
export interface StandaloneSessionManagementService {
  list(
    input: StandaloneListSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleListPage>;
  listRetired(
    input: StandaloneListRetiredSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<RetiredSessionListPage>;
  inspect(
    input: StandaloneSessionReferenceInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleInspection | undefined>;
  listTurns(
    input: StandaloneListSessionTurnsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionTurnPage | undefined>;
  retire(
    input: StandaloneSessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  restore(
    input: StandaloneSessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  purge(input: StandalonePurgeSessionInput, options?: ManagementOperationOptions): Promise<void>;
  recover(
    input: StandaloneRecoverSessionExecutionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionExecutionFence>;
}

export interface StandaloneListSessionsInput {
  readonly agentId: string;
  readonly cursor?: Readonly<{ readonly updatedAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface StandaloneListRetiredSessionsInput {
  readonly agentId: string;
  readonly cursor?: Readonly<{ readonly retiredAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface StandaloneListSessionTurnsInput extends StandaloneSessionReferenceInput {
  readonly beforeTurnId?: string;
  readonly limit?: number;
}

export interface StandaloneSessionLifecycleMutationInput extends StandaloneSessionReferenceInput {
  readonly expectedRevision: number;
}

export interface StandalonePurgeSessionInput extends StandaloneSessionLifecycleMutationInput {
  readonly confirmation: 'permanently-delete-session';
}

export interface StandaloneRecoverSessionExecutionsInput extends StandaloneSessionReferenceInput {
  readonly expectedExecutionRevision: number;
}
