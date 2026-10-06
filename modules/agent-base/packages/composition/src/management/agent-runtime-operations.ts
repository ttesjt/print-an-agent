import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import { Agent } from '@ta-agent/base-workflow';
import { createManagedAgentAuthorityPorts, readManagedAgentAuthority } from './authority.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { AgentManagementError } from './errors.js';
import { resolveManagedAgentNamespace } from './namespace.js';
import type { RawManagedAgent } from './contracts/runtime.js';

function runtimeInvalid(message: string): never {
  throw new AgentManagementError('MANAGED_AGENT_RUNTIME_INVALID', 'open', message);
}

function runtimeOpeningFailed(): AgentManagementError {
  return new AgentManagementError(
    'MANAGED_AGENT_OPERATION_FAILED',
    'open',
    'Managed Agent runtime opening failed.'
  );
}

function validateMaterializedAgent<TAgent>(
  value: unknown,
  expectedAgentId: AgentId,
  expectedDisplayName: string
): RawManagedAgent<TAgent> {
  if (!(value instanceof Agent)) {
    return runtimeInvalid('Managed Agent runtime materializer must return a raw Agent.');
  }
  if (value.identity.id !== expectedAgentId || value.identity.displayName !== expectedDisplayName) {
    return runtimeInvalid(
      'Managed Agent runtime materializer returned an Agent with a different Identity.'
    );
  }
  return value as RawManagedAgent<TAgent>;
}

export async function openManagedAgentRuntime<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
  agentIdInput: AgentId
): Promise<RawManagedAgent<TAgent>> {
  const agentId = parseAgentId(agentIdInput);
  const namespace = await resolveManagedAgentNamespace('open', definition.namespace.port, agentId);
  const authorityPorts = createManagedAgentAuthorityPorts('open', definition, namespace);
  const authority = await readManagedAgentAuthority<TConfig>(
    'open',
    agentId,
    authorityPorts,
    definition.config.codec
  );
  if (authority.identity.status !== 'active') {
    throw new AgentManagementError('MANAGED_AGENT_DISABLED', 'open', 'Managed Agent is disabled.');
  }

  let runtimePorts: TRuntimePorts;
  try {
    runtimePorts = await definition.runtime.createPorts(
      Object.freeze({ namespace, identity: authority.identity, config: authority.config })
    );
  } catch {
    throw runtimeOpeningFailed();
  }

  let materialized: unknown;
  try {
    materialized = await definition.runtime.materialize(
      Object.freeze({
        identity: authority.identity.identity,
        config: authority.config.value,
        ports: runtimePorts,
      })
    );
  } catch {
    throw runtimeOpeningFailed();
  }

  return validateMaterializedAgent<TAgent>(
    materialized,
    authority.identity.identity.id,
    authority.identity.identity.displayName
  );
}
