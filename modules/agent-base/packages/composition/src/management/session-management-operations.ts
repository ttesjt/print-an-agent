import type { AgentId } from '@print-an-agent/base-identity';
import {
  normalizeListRetiredSessionsInput,
  normalizeListSessionsInput,
  normalizeListSessionTurnsInput,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
  normalizeSessionLifecycleMutationInput,
  normalizeSessionReference,
  type ListRetiredSessionsInput,
  type ListSessionTurnsInput,
  type ListSessionsInput,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type RetiredSessionListPage,
  type SessionExecutionFence,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type SessionLifecycleMutationInput,
  type SessionLifecyclePort,
  type SessionLifecycleQueryPort,
  type SessionLifecycleSnapshot,
  type SessionReference,
  type SessionTurnPage,
} from '@print-an-agent/base-session';
import type {
  CoordinatedSessionMaintenancePort,
  SessionManagementCapability,
  SessionManagementPorts,
} from './contracts/session-management.js';
import type { ManagedAgentNamespacePort } from './contracts/namespace.js';
import { AgentManagementError, type AgentManagementOperation } from './errors.js';
import { resolveManagedAgentNamespace } from './namespace.js';
import { assertManagementOperationActive } from './operation.js';

type SessionManagedDefinition<TNamespaceHandle> = Readonly<{
  namespace: Readonly<{ port: ManagedAgentNamespacePort<TNamespaceHandle> }>;
}> &
  SessionManagementCapability<TNamespaceHandle, SessionManagementPorts>;

function invalidPorts(operation: AgentManagementOperation, message: string): never {
  throw new AgentManagementError('MANAGED_AGENT_SESSION_INVALID', operation, message);
}

function findDataProperty(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function requireObject(
  operation: AgentManagementOperation,
  value: unknown,
  fieldPath: string
): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return invalidPorts(operation, `Session management ${fieldPath} must be an object.`);
  }
  return value;
}

function requireFunctionMember(
  operation: AgentManagementOperation,
  value: object,
  fieldPath: string,
  memberName: string
): void {
  if (typeof findDataProperty(value, memberName) !== 'function') {
    invalidPorts(operation, `Session management ${fieldPath}.${memberName} must be a function.`);
  }
}

function validateSessionPort(
  operation: AgentManagementOperation,
  value: unknown
): asserts value is SessionLifecycleQueryPort & SessionLifecyclePort {
  const port = requireObject(operation, value, 'ports.session');
  for (const method of [
    'listSessions',
    'inspectSession',
    'listRetiredSessions',
    'listSessionTurns',
    'retireSession',
    'restoreSession',
  ]) {
    requireFunctionMember(operation, port, 'ports.session', method);
  }
}

function validateMaintenancePort(
  operation: AgentManagementOperation,
  value: unknown
): asserts value is CoordinatedSessionMaintenancePort {
  const port = requireObject(operation, value, 'ports.maintenance');
  requireFunctionMember(operation, port, 'ports.maintenance', 'purgeSessionPersistence');
  requireFunctionMember(operation, port, 'ports.maintenance', 'recoverSessionPersistence');
}

function validateSessionManagementPorts(
  operation: AgentManagementOperation,
  value: unknown
): SessionManagementPorts {
  const ports = requireObject(operation, value, 'ports');
  const session = findDataProperty(ports, 'session');
  const maintenance = findDataProperty(ports, 'maintenance');
  validateSessionPort(operation, session);
  validateMaintenancePort(operation, maintenance);
  return Object.freeze({ session, maintenance });
}

async function withSessionManagementPorts<TNamespaceHandle, TResult>(
  operation: AgentManagementOperation,
  definition: SessionManagedDefinition<TNamespaceHandle>,
  agentId: AgentId,
  signal: AbortSignal | undefined,
  action: (ports: SessionManagementPorts) => Promise<TResult>
): Promise<TResult> {
  assertManagementOperationActive(operation, signal);
  const namespace = await resolveManagedAgentNamespace(
    operation,
    definition.namespace.port,
    agentId
  );
  assertManagementOperationActive(operation, signal);
  const ports = validateSessionManagementPorts(
    operation,
    await definition.sessionManagement.createPorts(namespace)
  );
  assertManagementOperationActive(operation, signal);
  return action(ports);
}

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
