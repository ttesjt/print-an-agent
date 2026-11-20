import {
  disableAgentIdentity,
  parseAgentId,
  reactivateAgentIdentity,
  renameAgentIdentity,
  type AgentIdentityCatalogPort,
} from '@print-an-agent/base-identity-config/identity';
import {
  createManagedAgentAuthorityPorts,
  readManagedAgentAuthority,
  type ManagedAgentAuthority,
} from '../authority/index.js';
import { resolveManagedAgentNamespace } from '../namespace/index.js';
import { assertManagementOperationActive } from '../operation/index.js';
import {
  createManagedAgentCommitResult,
  reconcileCommittedManagedAgentProjection,
} from './projection.js';
import { validateExpectedRevision } from './revision.js';
import type { AgentManagementContext } from './types/context.js';
import type {
  ManagedAgentCommitResult,
  RenameManagedAgentRequest,
  TransitionManagedAgentRequest,
} from './types/management.js';

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

export async function renameManagedAgent<TConfig, Handle>(
  definition: AgentManagementContext<TConfig, Handle>,
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

export async function transitionManagedAgent<TConfig, TNamespaceHandle>(
  operation: 'disable' | 'reactivate',
  definition: AgentManagementContext<TConfig, TNamespaceHandle>,
  request: TransitionManagedAgentRequest,
  signal: AbortSignal | undefined
): Promise<ManagedAgentCommitResult<TConfig>> {
  assertManagementOperationActive(operation, signal);
  const agentId = parseAgentId(request.agentId);
  const expectedRevision = validateExpectedRevision(
    operation,
    request.expectedIdentityRevision,
    'Expected Identity revision'
  );
  const namespace = await resolveManagedAgentNamespace(
    operation,
    definition.namespace.port,
    agentId
  );
  assertManagementOperationActive(operation, signal);
  const ports = createManagedAgentAuthorityPorts(operation, definition, namespace);
  const current = await readManagedAgentAuthority<TConfig>(
    operation,
    agentId,
    ports,
    definition.config.codec
  );
  assertManagementOperationActive(operation, signal);
  const transition = operation === 'disable' ? disableAgentIdentity : reactivateAgentIdentity;
  const identity = await transition({
    agentId,
    catalog: ports.identityCatalog,
    expectedRevision,
  });
  const authority: ManagedAgentAuthority<TConfig> = Object.freeze({
    identity,
    config: current.config,
  });
  const projection = await reconcileCommittedManagedAgentProjection(
    operation,
    definition,
    namespace,
    authority
  );
  return createManagedAgentCommitResult(operation, authority, projection);
}
