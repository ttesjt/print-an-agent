import {
  resolveAgentConfig,
  writeAgentConfig,
  type AgentConfigCodec,
} from '@print-an-agent/base-identity-config/config';
import {
  AgentIdentityError,
  createAgentIdentity,
  defineAgentIdentitySnapshot,
  type AgentIdentity,
  type AgentIdentitySnapshot,
} from '@print-an-agent/base-identity-config/identity';
import { AgentManagementError } from '../operation/index.js';
import { managedAgentConfigsEqual } from './config-codec.js';
import { authorityInvalid } from './create-ports.js';
import { authority } from './read.js';
import type { ManagedAgentAuthorityPorts } from './types/ports.js';
import type { ManagedAgentAuthority } from './types/snapshot.js';

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
