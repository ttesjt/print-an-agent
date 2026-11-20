import {
  resolveAgentConfig,
  type AgentConfigCodec,
} from '@print-an-agent/base-identity-config/config';
import {
  readAgentIdentity,
  type AgentId,
  type AgentIdentitySnapshot,
} from '@print-an-agent/base-identity-config/identity';
import type { AgentManagementOperation } from '../operation/index.js';
import { authorityInvalid } from './create-ports.js';
import type { ManagedAgentAuthorityPorts } from './types/ports.js';
import type { ManagedAgentAuthority, ManagedAgentConfigSnapshot } from './types/snapshot.js';

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

export function authority<TConfig>(
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
