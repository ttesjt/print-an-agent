import type {
  SessionManagementPorts,
  SessionManagementService,
} from './contracts/session-management.js';
import type { SessionManagedAgentCompositionDefinition } from './definition.js';
import { runManagementOperation } from './failures.js';
import {
  inspectManagedSession,
  listManagedSessions,
  listManagedSessionTurns,
  listRetiredManagedSessions,
  purgeManagedSession,
  recoverManagedSession,
  restoreManagedSession,
  retireManagedSession,
} from './session-management-operations.js';

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
    list: (input) =>
      runManagementOperation('list-sessions', () => listManagedSessions(definition, input)),
    listRetired: (input) =>
      runManagementOperation('list-retired-sessions', () =>
        listRetiredManagedSessions(definition, input)
      ),
    inspect: (input) =>
      runManagementOperation('inspect-session', () => inspectManagedSession(definition, input)),
    listTurns: (input) =>
      runManagementOperation('list-session-turns', () =>
        listManagedSessionTurns(definition, input)
      ),
    retire: (input) =>
      runManagementOperation('retire-session', () => retireManagedSession(definition, input)),
    restore: (input) =>
      runManagementOperation('restore-session', () => restoreManagedSession(definition, input)),
    purge: (input) =>
      runManagementOperation('purge-session', () => purgeManagedSession(definition, input)),
    recover: (input) =>
      runManagementOperation('recover-session', () => recoverManagedSession(definition, input)),
  } satisfies SessionManagementService);
}
