import { isAgentId, parseAgentId, type AgentId } from '@print-an-agent/base-identity';
import type {
  ManagedAgentNamespace,
  ManagedAgentNamespacePort,
  StagedManagedAgentNamespace,
} from './contracts/namespace.js';
import { AgentManagementError, type AgentManagementOperation } from './errors.js';

function invalidNamespace(operation: AgentManagementOperation, message: string): never {
  throw new AgentManagementError('MANAGED_AGENT_NAMESPACE_INVALID', operation, message);
}

function assertNamespaceObject(operation: AgentManagementOperation, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidNamespace(operation, 'Managed Agent namespace returned an invalid record.');
  }
}

function assertNamespaceAgentId(
  operation: AgentManagementOperation,
  actual: unknown,
  expected: AgentId
): void {
  if (!isAgentId(actual) || actual !== expected) {
    invalidNamespace(
      operation,
      'Managed Agent namespace returned resources for a different Agent ID.'
    );
  }
}

export function validateStagedNamespace<TNamespaceHandle>(
  operation: AgentManagementOperation,
  namespace: StagedManagedAgentNamespace<TNamespaceHandle>,
  expectedAgentId: AgentId
): StagedManagedAgentNamespace<TNamespaceHandle> {
  assertNamespaceObject(operation, namespace);
  assertNamespaceAgentId(operation, namespace.agentId, expectedAgentId);
  if (namespace.phase !== 'staged' || typeof namespace.resumed !== 'boolean') {
    return invalidNamespace(operation, 'Managed Agent namespace returned an invalid staged state.');
  }
  return namespace;
}

export function validatePublishedNamespace<TNamespaceHandle>(
  operation: AgentManagementOperation,
  namespace: ManagedAgentNamespace<TNamespaceHandle>,
  expectedAgentId: AgentId
): ManagedAgentNamespace<TNamespaceHandle> {
  assertNamespaceObject(operation, namespace);
  assertNamespaceAgentId(operation, namespace.agentId, expectedAgentId);
  if (namespace.phase !== 'published') {
    return invalidNamespace(
      operation,
      'Managed Agent namespace returned a resource that is not published.'
    );
  }
  return namespace;
}

export async function resolveManagedAgentNamespace<TNamespaceHandle>(
  operation: AgentManagementOperation,
  port: ManagedAgentNamespacePort<TNamespaceHandle>,
  agentIdInput: AgentId
): Promise<ManagedAgentNamespace<TNamespaceHandle>> {
  const agentId = parseAgentId(agentIdInput);
  const namespace = await port.resolve(agentId);
  if (namespace === undefined) {
    throw new AgentManagementError(
      'MANAGED_AGENT_NOT_FOUND',
      operation,
      'Managed Agent does not exist.'
    );
  }
  return validatePublishedNamespace(operation, namespace, agentId);
}

export async function listManagedAgentNamespaces<TNamespaceHandle>(
  port: ManagedAgentNamespacePort<TNamespaceHandle>
): Promise<readonly ManagedAgentNamespace<TNamespaceHandle>[]> {
  const listed = await port.list();
  if (!Array.isArray(listed as unknown)) {
    return invalidNamespace('list', 'Managed Agent namespace listing must be an array.');
  }

  const namespaces: ManagedAgentNamespace<TNamespaceHandle>[] = [];
  const seen = new Set<AgentId>();
  for (const namespace of listed) {
    assertNamespaceObject('list', namespace);
    if (!isAgentId(namespace.agentId)) {
      return invalidNamespace(
        'list',
        'Managed Agent namespace listing contains an invalid Agent ID.'
      );
    }
    const validated = validatePublishedNamespace('list', namespace, namespace.agentId);
    if (seen.has(validated.agentId)) {
      return invalidNamespace(
        'list',
        'Managed Agent namespace listing contains a duplicate Agent ID.'
      );
    }
    seen.add(validated.agentId);
    namespaces.push(validated);
  }
  namespaces.sort((left, right) => left.agentId.localeCompare(right.agentId));
  return Object.freeze(namespaces);
}
