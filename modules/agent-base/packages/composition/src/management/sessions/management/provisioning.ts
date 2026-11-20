import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { SessionLifecyclePort, SessionLifecycleQueryPort } from '@print-an-agent/base-session';
import { resolveManagedAgentNamespace } from '../../namespace/index.js';
import {
  AgentManagementError,
  type AgentManagementOperation,
  assertManagementOperationActive,
} from '../../operation/index.js';
import type { SessionManagedDefinition } from './types/context.js';
import type { CoordinatedSessionMaintenancePort, SessionManagementPorts } from './types/ports.js';

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

export async function withSessionManagementPorts<TNamespaceHandle, TResult>(
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
