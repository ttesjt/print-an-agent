import {
  isAgentId,
  parseAgentId,
  type AgentId,
} from '@print-an-agent/base-identity-config/identity';
import { AgentManagementError, type AgentManagementOperation } from '../operation/index.js';
import type { ManagedAgentNamespace, ManagedAgentNamespacePort } from './types.js';
import {
  assertNamespaceObject,
  invalidNamespace,
  validatePublishedNamespace,
} from './validation.js';

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
