import {
  parseAgentId,
  renameAgentIdentity,
  type AgentIdentityCatalogPort,
} from '@print-an-agent/base-identity-config/identity';
import { createManagedAgentAuthorityPorts, readManagedAgentAuthority } from './authority.js';
import type {
  ManagedAgentCommitResult,
  RenameManagedAgentRequest,
} from './contracts/agent-management.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { resolveManagedAgentNamespace } from './namespace.js';
import { assertManagementOperationActive } from './operation.js';
import {
  createManagedAgentCommitResult,
  reconcileCommittedManagedAgentProjection,
} from './projection.js';

function guardIdentityRenameCommit(
  catalog: AgentIdentityCatalogPort,
  signal: AbortSignal | undefined
): AgentIdentityCatalogPort {
  const rename = catalog.rename;
  if (rename === undefined) return catalog;

  const guarded: AgentIdentityCatalogPort = {
    create: (request) => catalog.create(request),
    read: (agentId) => catalog.read(agentId),
    list: () => catalog.list(),
    transition: (request) => catalog.transition(request),
    rename: (request) => {
      assertManagementOperationActive('rename', signal);
      return rename.call(catalog, request);
    },
  };
  return Object.freeze(guarded);
}

export async function renameManagedAgent<TConfig, Handle, Ports, TAgent>(
  definition: ManagedAgentCompositionDefinition<TConfig, Handle, Ports, TAgent>,
  request: RenameManagedAgentRequest,
  signal: AbortSignal | undefined
): Promise<ManagedAgentCommitResult<TConfig>> {
  assertManagementOperationActive('rename', signal);
  const agentId = parseAgentId(request.agentId);
  const namespace = await resolveManagedAgentNamespace(
    'rename',
    definition.namespace.port,
    agentId
  );
  assertManagementOperationActive('rename', signal);
  const ports = createManagedAgentAuthorityPorts('rename', definition, namespace);
  const current = await readManagedAgentAuthority<TConfig>(
    'rename',
    agentId,
    ports,
    definition.config.codec
  );
  assertManagementOperationActive('rename', signal);
  const identity = await renameAgentIdentity({
    agentId,
    catalog: guardIdentityRenameCommit(ports.identityCatalog, signal),
    displayName: request.displayName,
    expectedRevision: request.expectedIdentityRevision,
  });
  const authority = Object.freeze({ identity, config: current.config });
  const projection = await reconcileCommittedManagedAgentProjection(
    'rename',
    definition,
    namespace,
    authority
  );
  return createManagedAgentCommitResult('rename', authority, projection);
}
