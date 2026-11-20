import { isAgentId, type AgentId } from '@print-an-agent/base-identity-config/identity';
import { AgentManagementError, type AgentManagementOperation } from '../operation/index.js';
import type { ManagedAgentNamespace, StagedManagedAgentNamespace } from './types.js';

export function invalidNamespace(operation: AgentManagementOperation, message: string): never {
  throw new AgentManagementError('MANAGED_AGENT_NAMESPACE_INVALID', operation, message);
}

export function assertNamespaceObject(operation: AgentManagementOperation, value: unknown): void {
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
