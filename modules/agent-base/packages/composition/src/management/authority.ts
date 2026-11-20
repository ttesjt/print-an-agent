import {
  resolveAgentConfig,
  writeAgentConfig,
  type AgentConfigCodec,
} from '@print-an-agent/base-identity-config/config';
import {
  AgentIdentityError,
  createAgentIdentity,
  defineAgentIdentitySnapshot,
  readAgentIdentity,
  type AgentId,
  type AgentIdentity,
  type AgentIdentitySnapshot,
} from '@print-an-agent/base-identity-config/identity';
import { managedAgentConfigsEqual } from './config.js';
import type { ManagedAgentAuthorityPorts } from './contracts/authority.js';
import type { ManagedAgentConfigSnapshot } from './contracts/agent-management.js';
import type { ManagedAgentNamespaceReference } from './contracts/namespace.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { AgentManagementError, type AgentManagementOperation } from './errors.js';

export interface ManagedAgentAuthority<TConfig> {
  readonly identity: AgentIdentitySnapshot;
  readonly config: ManagedAgentConfigSnapshot<TConfig>;
}

function authorityInvalid(operation: AgentManagementOperation, message: string): never {
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

export function createManagedAgentAuthorityPorts<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  operation: AgentManagementOperation,
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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

function configSnapshot<TConfig>(
  operation: AgentManagementOperation,
  value: TConfig,
  revision: number
): ManagedAgentConfigSnapshot<TConfig> {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return authorityInvalid(
      operation,
      'Managed Agent Config authority returned an invalid revision.'
    );
  }
  return Object.freeze({ value, revision });
}

function authority<TConfig>(
  operation: AgentManagementOperation,
  identity: AgentIdentitySnapshot,
  config: TConfig,
  revision: number
): ManagedAgentAuthority<TConfig> {
  return Object.freeze({ identity, config: configSnapshot(operation, config, revision) });
}

export async function readManagedAgentAuthority<TConfig>(
  operation: AgentManagementOperation,
  agentId: AgentId,
  ports: ManagedAgentAuthorityPorts,
  codec: AgentConfigCodec<TConfig>
): Promise<ManagedAgentAuthority<TConfig>> {
  const identity = await readAgentIdentity({ agentId, catalog: ports.identityCatalog });
  const resolved = await resolveAgentConfig({
    identity: identity.identity,
    codec,
    adapter: ports.config,
  });
  if (resolved.revision === null) {
    return authorityInvalid(
      operation,
      'Managed Agent Config authority must have a stored revision.'
    );
  }
  return authority(operation, identity, resolved.config, resolved.revision);
}

function sameIdentity(left: AgentIdentity, right: AgentIdentity): boolean {
  return left.id === right.id && left.displayName === right.displayName;
}

function provisioningConflict(message: string): never {
  throw new AgentManagementError('MANAGED_AGENT_PROVISIONING_CONFLICT', 'create', message);
}

function validateStoredIdentity(
  stored: AgentIdentitySnapshot,
  expected: AgentIdentity,
  resumed: boolean
): AgentIdentitySnapshot {
  const normalized = defineAgentIdentitySnapshot(stored);
  if (normalized.identity.id !== expected.id) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Agent Identity catalog returned authority for a different Agent ID.'
    );
  }
  if (
    !resumed ||
    normalized.status !== 'active' ||
    normalized.revision !== 1 ||
    !sameIdentity(normalized.identity, expected)
  ) {
    provisioningConflict('Staged Agent Identity conflicts with the requested initial authority.');
  }
  return normalized;
}

export async function initializeManagedAgentAuthority<TConfig>(
  identityInput: AgentIdentity,
  configInput: TConfig,
  ports: ManagedAgentAuthorityPorts,
  codec: AgentConfigCodec<TConfig>,
  resumed: boolean
): Promise<ManagedAgentAuthority<TConfig>> {
  const storedIdentity = await ports.identityCatalog.read(identityInput.id);
  const identity =
    storedIdentity === undefined
      ? await createAgentIdentity({ identity: identityInput, catalog: ports.identityCatalog })
      : validateStoredIdentity(storedIdentity, identityInput, resumed);

  const storedConfig = await ports.config.read(identityInput.id);
  if (storedConfig === undefined) {
    const written = await writeAgentConfig({
      identity: identity.identity,
      codec,
      adapter: ports.config,
      config: configInput,
      expectedRevision: null,
    });
    if (written.revision !== 1) {
      return authorityInvalid('create', 'New Managed Agent Config must begin at revision 1.');
    }
    return authority('create', identity, written.config, written.revision);
  }

  const resolved = await resolveAgentConfig({
    identity: identity.identity,
    codec,
    adapter: ports.config,
  });
  if (
    !resumed ||
    resolved.revision !== 1 ||
    !managedAgentConfigsEqual(codec, resolved.config, configInput)
  ) {
    return provisioningConflict(
      'Staged Agent Config conflicts with the requested initial authority.'
    );
  }
  return authority('create', identity, resolved.config, resolved.revision);
}

export function createManagedAgentAuthority<TConfig>(
  operation: AgentManagementOperation,
  identity: AgentIdentitySnapshot,
  config: TConfig,
  revision: number,
  expectedPreviousRevision: number
): ManagedAgentAuthority<TConfig> {
  if (revision !== expectedPreviousRevision + 1) {
    return authorityInvalid(operation, 'Managed Agent Config did not advance by one revision.');
  }
  return authority(operation, identity, config, revision);
}
