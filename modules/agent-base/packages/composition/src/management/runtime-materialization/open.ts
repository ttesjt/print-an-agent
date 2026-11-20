import type { AgentConfigCodec } from '@print-an-agent/base-identity-config/config';
import { parseAgentId, type AgentId } from '@print-an-agent/base-identity-config/identity';
import { Agent } from '@print-an-agent/base-runtime';
import {
  createManagedAgentAuthorityPorts,
  readManagedAgentAuthority,
  type ManagedAgentAuthorityPortFactory,
} from '../authority/index.js';
import {
  resolveManagedAgentNamespace,
  type ManagedAgentNamespacePort,
} from '../namespace/index.js';
import { AgentManagementError } from '../operation/index.js';
import type {
  ManagedAgentRuntimeMaterializer,
  ManagedAgentRuntimePortFactory,
  RawManagedAgent,
} from './types/runtime.js';

interface RuntimeContext<C, N, P, A> {
  readonly config: Readonly<{ codec: AgentConfigCodec<C> }>;
  readonly namespace: Readonly<{ port: ManagedAgentNamespacePort<N> }>;
  readonly authority: Readonly<{ createPorts: ManagedAgentAuthorityPortFactory<N> }>;
  readonly runtime: Readonly<{
    createPorts: ManagedAgentRuntimePortFactory<C, N, P>;
    materialize: ManagedAgentRuntimeMaterializer<C, P, A>;
  }>;
}

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
  definition: RuntimeContext<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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
