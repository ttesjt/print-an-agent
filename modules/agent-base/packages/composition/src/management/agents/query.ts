import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { createManagedAgentAuthorityPorts, readManagedAgentAuthority } from '../authority/index.js';
import {
  type ManagedAgentNamespace,
  type ManagedAgentNamespacePort,
  listManagedAgentNamespaces,
  resolveManagedAgentNamespace,
} from '../namespace/index.js';
import {
  type AgentManagementOperation,
  assertManagementOperationActive,
} from '../operation/index.js';
import { createManagedAgentSnapshot, reconcileManagedAgentProjection } from './projection.js';
import type { AgentManagementContext } from './types/context.js';
import type { ManagedAgentSnapshot } from './types/management.js';

async function inspectNamespace<TConfig, TNamespaceHandle>(
  operation: AgentManagementOperation,
  definition: AgentManagementContext<TConfig, TNamespaceHandle>,
  namespace: ManagedAgentNamespace<TNamespaceHandle>,
  signal: AbortSignal | undefined
): Promise<ManagedAgentSnapshot<TConfig>> {
  assertManagementOperationActive(operation, signal);
  const ports = createManagedAgentAuthorityPorts(operation, definition, namespace);
  const authority = await readManagedAgentAuthority<TConfig>(
    operation,
    namespace.agentId,
    ports,
    definition.config.codec
  );
  assertManagementOperationActive(operation, signal);
  const projection = await reconcileManagedAgentProjection(
    operation,
    definition,
    namespace,
    authority
  );
  return createManagedAgentSnapshot(authority, projection);
}

export async function inspectManagedAgent<TConfig, TNamespaceHandle>(
  definition: AgentManagementContext<TConfig, TNamespaceHandle>,
  agentIdInput: Parameters<ManagedAgentNamespacePort<TNamespaceHandle>['resolve']>[0],
  signal: AbortSignal | undefined
): Promise<ManagedAgentSnapshot<TConfig>> {
  assertManagementOperationActive('inspect', signal);
  const agentId = parseAgentId(agentIdInput);
  const namespace = await resolveManagedAgentNamespace(
    'inspect',
    definition.namespace.port,
    agentId
  );
  assertManagementOperationActive('inspect', signal);
  return await inspectNamespace('inspect', definition, namespace, signal);
}

export async function listManagedAgents<TConfig, TNamespaceHandle>(
  definition: AgentManagementContext<TConfig, TNamespaceHandle>,
  signal: AbortSignal | undefined
): Promise<readonly ManagedAgentSnapshot<TConfig>[]> {
  assertManagementOperationActive('list', signal);
  const namespaces = await listManagedAgentNamespaces(definition.namespace.port);
  assertManagementOperationActive('list', signal);
  const snapshots: ManagedAgentSnapshot<TConfig>[] = [];
  for (const namespace of namespaces) {
    assertManagementOperationActive('list', signal);
    snapshots.push(await inspectNamespace('list', definition, namespace, signal));
  }
  return Object.freeze(snapshots);
}
