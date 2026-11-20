import { writeAgentConfig } from '@print-an-agent/base-identity-config/config';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  canonicalizeManagedAgentConfig,
  createManagedAgentAuthority,
  createManagedAgentAuthorityPorts,
  decodeManagedAgentConfig,
  readManagedAgentAuthority,
} from '../authority/index.js';
import { resolveManagedAgentNamespace } from '../namespace/index.js';
import { AgentManagementError, assertManagementOperationActive } from '../operation/index.js';
import {
  createManagedAgentCommitResult,
  reconcileCommittedManagedAgentProjection,
} from './projection.js';
import { validateExpectedRevision } from './revision.js';
import type { AgentManagementContext } from './types/context.js';
import type {
  ImportManagedAgentConfigRequest,
  ManagedAgentCommitResult,
  UpdateManagedAgentConfigRequest,
} from './types/management.js';

export async function updateManagedAgentConfig<TConfig, TNamespaceHandle>(
  operation: 'update-config' | 'import-config',
  definition: AgentManagementContext<TConfig, TNamespaceHandle>,
  request: UpdateManagedAgentConfigRequest<TConfig>,
  signal: AbortSignal | undefined
): Promise<ManagedAgentCommitResult<TConfig>> {
  assertManagementOperationActive(operation, signal);
  const agentId = parseAgentId(request.agentId);
  const expectedRevision = validateExpectedRevision(
    operation,
    request.expectedRevision,
    'Expected Config revision'
  );
  const config = canonicalizeManagedAgentConfig(definition.config.codec, request.config);
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
  const updated = await writeAgentConfig({
    identity: current.identity.identity,
    codec: definition.config.codec,
    adapter: ports.config,
    config,
    expectedRevision,
  });
  if (updated.revision === null) {
    throw new AgentManagementError(
      'MANAGED_AGENT_AUTHORITY_INVALID',
      operation,
      'Managed Agent Config update did not produce a stored revision.'
    );
  }
  const authority = createManagedAgentAuthority(
    operation,
    current.identity,
    updated.config,
    updated.revision,
    expectedRevision
  );
  const projection = await reconcileCommittedManagedAgentProjection(
    operation,
    definition,
    namespace,
    authority
  );
  return createManagedAgentCommitResult(operation, authority, projection);
}

export function importManagedAgentConfig<TConfig, TNamespaceHandle>(
  definition: AgentManagementContext<TConfig, TNamespaceHandle>,
  request: ImportManagedAgentConfigRequest,
  signal: AbortSignal | undefined
): Promise<ManagedAgentCommitResult<TConfig>> {
  assertManagementOperationActive('import-config', signal);
  const config = decodeManagedAgentConfig(definition.config.codec, request.input);
  return updateManagedAgentConfig(
    'import-config',
    definition,
    {
      agentId: request.agentId,
      config,
      expectedRevision: request.expectedRevision,
    },
    signal
  );
}
