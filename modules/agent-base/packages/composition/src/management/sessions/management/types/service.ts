import type {
  ListRetiredSessionsInput,
  ListSessionTurnsInput,
  ListSessionsInput,
  PurgeSessionInput,
  RecoverSessionExecutionsInput,
  RetiredSessionListPage,
  SessionExecutionFence,
  SessionLifecycleInspection,
  SessionLifecycleListPage,
  SessionLifecycleMutationInput,
  SessionLifecycleSnapshot,
  SessionReference,
  SessionTurnPage,
} from '@print-an-agent/base-session';
import type { ManagementOperationOptions } from '../../../operation/index.js';

/** Out-of-band lifecycle management for Sessions owned by one published managed Agent. */
export interface SessionManagementService {
  list(
    input: ListSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleListPage>;
  listRetired(
    input: ListRetiredSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<RetiredSessionListPage>;
  inspect(
    reference: SessionReference,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleInspection | undefined>;
  listTurns(
    input: ListSessionTurnsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionTurnPage | undefined>;
  retire(
    input: SessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  restore(
    input: SessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  purge(input: PurgeSessionInput, options?: ManagementOperationOptions): Promise<void>;
  recover(
    input: RecoverSessionExecutionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionExecutionFence>;
}
