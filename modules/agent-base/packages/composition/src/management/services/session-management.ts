import type { SessionManagedAgentCompositionDefinition } from '../definition/index.js';
import {
  type ManagementOperationOptions,
  normalizeManagementOperationOptions,
} from '../operation/index.js';
import {
  type SessionManagementPorts,
  type SessionManagementService,
  inspectManagedSession,
  listManagedSessions,
  listManagedSessionTurns,
  listRetiredManagedSessions,
  purgeManagedSession,
  recoverManagedSession,
  restoreManagedSession,
  retireManagedSession,
} from '../sessions/index.js';
import { runManagementOperation } from './failures.js';

/** Creates a zero-I/O Service for Definitions with standard out-of-band Session management. */
export function createSessionManagementService<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionManagementPorts extends SessionManagementPorts,
>(
  definition: SessionManagedAgentCompositionDefinition<
    TConfig,
    TNamespaceHandle,
    TRuntimePorts,
    TAgent,
    TSessionManagementPorts
  >
): SessionManagementService {
  return Object.freeze({
    list: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('list-sessions', () => {
        const { signal } = normalizeManagementOperationOptions('list-sessions', options);
        return listManagedSessions(definition, input, signal);
      }),
    listRetired: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('list-retired-sessions', () => {
        const { signal } = normalizeManagementOperationOptions('list-retired-sessions', options);
        return listRetiredManagedSessions(definition, input, signal);
      }),
    inspect: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('inspect-session', () => {
        const { signal } = normalizeManagementOperationOptions('inspect-session', options);
        return inspectManagedSession(definition, input, signal);
      }),
    listTurns: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('list-session-turns', () => {
        const { signal } = normalizeManagementOperationOptions('list-session-turns', options);
        return listManagedSessionTurns(definition, input, signal);
      }),
    retire: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('retire-session', () => {
        const { signal } = normalizeManagementOperationOptions('retire-session', options);
        return retireManagedSession(definition, input, signal);
      }),
    restore: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('restore-session', () => {
        const { signal } = normalizeManagementOperationOptions('restore-session', options);
        return restoreManagedSession(definition, input, signal);
      }),
    purge: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('purge-session', () => {
        const { signal } = normalizeManagementOperationOptions('purge-session', options);
        return purgeManagedSession(definition, input, signal);
      }),
    recover: (input, options?: ManagementOperationOptions) =>
      runManagementOperation('recover-session', () => {
        const { signal } = normalizeManagementOperationOptions('recover-session', options);
        return recoverManagedSession(definition, input, signal);
      }),
  } satisfies SessionManagementService);
}
