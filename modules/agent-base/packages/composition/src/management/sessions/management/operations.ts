import {
  normalizeListRetiredSessionsInput,
  normalizeListSessionsInput,
  normalizeListSessionTurnsInput,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
  normalizeSessionLifecycleMutationInput,
  normalizeSessionReference,
  type ListRetiredSessionsInput,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type RetiredSessionListPage,
  type SessionExecutionFence,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type SessionLifecycleMutationInput,
  type SessionLifecycleSnapshot,
  type SessionReference,
  type SessionTurnPage,
} from '@print-an-agent/base-session';
import { assertManagementOperationActive } from '../../operation/index.js';
import { withSessionManagementPorts } from './provisioning.js';
import type { SessionManagedDefinition } from './types/context.js';

export function listManagedSessions<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: ListSessionsInput,
  signal: AbortSignal | undefined
): Promise<SessionLifecycleListPage> {
  assertManagementOperationActive('list-sessions', signal);
  const request = normalizeListSessionsInput(input);
  return withSessionManagementPorts('list-sessions', definition, request.agentId, signal, (ports) =>
    ports.session.listSessions(request)
  );
}

export function listRetiredManagedSessions<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: ListRetiredSessionsInput,
  signal: AbortSignal | undefined
): Promise<RetiredSessionListPage> {
  assertManagementOperationActive('list-retired-sessions', signal);
  const request = normalizeListRetiredSessionsInput(input);
  return withSessionManagementPorts(
    'list-retired-sessions',
    definition,
    request.agentId,
    signal,
    (ports) => ports.session.listRetiredSessions(request)
  );
}

export function inspectManagedSession<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: SessionReference,
  signal: AbortSignal | undefined
): Promise<SessionLifecycleInspection | undefined> {
  assertManagementOperationActive('inspect-session', signal);
  const reference = normalizeSessionReference(input);
  return withSessionManagementPorts(
    'inspect-session',
    definition,
    reference.agentId,
    signal,
    (ports) => ports.session.inspectSession(reference)
  );
}

export function listManagedSessionTurns<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: ListSessionTurnsInput,
  signal: AbortSignal | undefined
): Promise<SessionTurnPage | undefined> {
  assertManagementOperationActive('list-session-turns', signal);
  const request = normalizeListSessionTurnsInput(input);
  return withSessionManagementPorts(
    'list-session-turns',
    definition,
    request.agentId,
    signal,
    (ports) => ports.session.listSessionTurns(request)
  );
}

export function retireManagedSession<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: SessionLifecycleMutationInput,
  signal: AbortSignal | undefined
): Promise<SessionLifecycleSnapshot> {
  assertManagementOperationActive('retire-session', signal);
  const request = normalizeSessionLifecycleMutationInput(input);
  return withSessionManagementPorts(
    'retire-session',
    definition,
    request.agentId,
    signal,
    (ports) => ports.session.retireSession(request)
  );
}

export function restoreManagedSession<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: SessionLifecycleMutationInput,
  signal: AbortSignal | undefined
): Promise<SessionLifecycleSnapshot> {
  assertManagementOperationActive('restore-session', signal);
  const request = normalizeSessionLifecycleMutationInput(input);
  return withSessionManagementPorts(
    'restore-session',
    definition,
    request.agentId,
    signal,
    (ports) => ports.session.restoreSession(request)
  );
}

export function purgeManagedSession<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: PurgeSessionInput,
  signal: AbortSignal | undefined
): Promise<void> {
  assertManagementOperationActive('purge-session', signal);
  const request = normalizePurgeSessionInput(input);
  return withSessionManagementPorts('purge-session', definition, request.agentId, signal, (ports) =>
    ports.maintenance.purgeSessionPersistence(request)
  );
}

export function recoverManagedSession<TNamespaceHandle>(
  definition: SessionManagedDefinition<TNamespaceHandle>,
  input: RecoverSessionExecutionsInput,
  signal: AbortSignal | undefined
): Promise<SessionExecutionFence> {
  assertManagementOperationActive('recover-session', signal);
  const request = normalizeRecoverSessionExecutionsInput(input);
  return withSessionManagementPorts(
    'recover-session',
    definition,
    request.agentId,
    signal,
    (ports) =>
      ports.maintenance.recoverSessionPersistence(request, signal === undefined ? {} : { signal })
  );
}
