import { parseAgentId, renameAgentIdentity } from '@ta-agent/base-identity';
import { createManagedAgentAuthorityPorts, readManagedAgentAuthority } from './authority.js';
import type { RenameManagedAgentRequest } from './contracts/agent-management.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { resolveManagedAgentNamespace } from './namespace.js';
import { createManagedAgentSnapshot, reconcileManagedAgentProjection } from './projection.js';

export async function renameManagedAgent<TConfig, Handle, Ports, TAgent>(
  definition: ManagedAgentCompositionDefinition<TConfig, Handle, Ports, TAgent>,
  request: RenameManagedAgentRequest
) {
  const agentId = parseAgentId(request.agentId);
  const namespace = await resolveManagedAgentNamespace(
    'rename',
    definition.namespace.port,
    agentId
  );
  const ports = createManagedAgentAuthorityPorts('rename', definition, namespace);
  await renameAgentIdentity({
    agentId,
    catalog: ports.identityCatalog,
    displayName: request.displayName,
    expectedRevision: request.expectedIdentityRevision,
  });
  const authority = await readManagedAgentAuthority<TConfig>(
    'rename',
    agentId,
    ports,
    definition.config.codec
  );
  const projection = await reconcileManagedAgentProjection(
    'rename',
    definition,
    namespace,
    authority
  );
  return createManagedAgentSnapshot(authority, projection);
}
