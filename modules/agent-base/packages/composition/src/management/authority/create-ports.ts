import type { ManagedAgentNamespaceReference } from '../namespace/index.js';
import { AgentManagementError, type AgentManagementOperation } from '../operation/index.js';
import type {
  ManagedAgentAuthorityPortFactory,
  ManagedAgentAuthorityPorts,
} from './types/ports.js';

export function authorityInvalid(operation: AgentManagementOperation, message: string): never {
  throw new AgentManagementError('MANAGED_AGENT_AUTHORITY_INVALID', operation, message);
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

function hasFunctionMember(value: object, key: string): boolean {
  return typeof findDataProperty(value, key) === 'function';
}

function isIdentityCatalog(value: unknown): value is ManagedAgentAuthorityPorts['identityCatalog'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasFunctionMember(value, 'read') &&
    hasFunctionMember(value, 'list') &&
    hasFunctionMember(value, 'create') &&
    hasFunctionMember(value, 'transition')
  );
}

function isConfigAdapter(value: unknown): value is ManagedAgentAuthorityPorts['config'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasFunctionMember(value, 'read') &&
    hasFunctionMember(value, 'write')
  );
}

export function createManagedAgentAuthorityPorts<TNamespaceHandle>(
  operation: AgentManagementOperation,
  definition: Readonly<{
    authority: Readonly<{ createPorts: ManagedAgentAuthorityPortFactory<TNamespaceHandle> }>;
  }>,
  namespace: ManagedAgentNamespaceReference<TNamespaceHandle>
): ManagedAgentAuthorityPorts {
  const ports = definition.authority.createPorts(namespace);
  if (typeof ports !== 'object' || ports === null) {
    return authorityInvalid(operation, 'Managed Agent authority factory returned invalid Ports.');
  }
  const identityCatalog = findDataProperty(ports, 'identityCatalog');
  const config = findDataProperty(ports, 'config');
  if (!isIdentityCatalog(identityCatalog) || !isConfigAdapter(config)) {
    return authorityInvalid(
      operation,
      'Managed Agent authority factory returned incomplete Ports.'
    );
  }
  return Object.freeze({ identityCatalog, config });
}
