import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  canonicalizeManagedAgentConfig,
  createManagedAgentAuthorityPorts,
  initializeManagedAgentAuthority,
} from '../authority/index.js';
import {
  type ManagedAgentNamespacePort,
  type StagedManagedAgentNamespace,
  validatePublishedNamespace,
  validateStagedNamespace,
} from '../namespace/index.js';
import { AgentManagementError, assertManagementOperationActive } from '../operation/index.js';
import {
  createManagedAgentCommitResult,
  publishCommittedManagedAgentProjection,
} from './projection.js';
import { summarizeManagementFailure } from './provisioning-failures.js';
import type { AgentManagementContext } from './types/context.js';
import type { CreateManagedAgentRequest, ManagedAgentCommitResult } from './types/management.js';

async function abortProvision<TNamespaceHandle>(
  namespacePort: ManagedAgentNamespacePort<TNamespaceHandle>,
  namespace: StagedManagedAgentNamespace<TNamespaceHandle>,
  cause: unknown
): Promise<never> {
  try {
    await namespacePort.abort(namespace);
  } catch (cleanupCause: unknown) {
    throw new AgentManagementError(
      'MANAGED_AGENT_PROVISIONING_CLEANUP_FAILED',
      'create',
      'Managed Agent provisioning and staged namespace cleanup both failed.',
      [summarizeManagementFailure(cause), summarizeManagementFailure(cleanupCause)]
    );
  }
  throw cause;
}

export async function createManagedAgent<TConfig, TNamespaceHandle>(
  definition: AgentManagementContext<TConfig, TNamespaceHandle>,
  request: CreateManagedAgentRequest<TConfig>,
  signal: AbortSignal | undefined
): Promise<ManagedAgentCommitResult<TConfig>> {
  assertManagementOperationActive('create', signal);
  const identity = defineAgentIdentity(request.identity);
  const config = canonicalizeManagedAgentConfig(definition.config.codec, request.config);
  const staged = validateStagedNamespace(
    'create',
    await definition.namespace.port.stage(identity.id),
    identity.id
  );
  let published = false;
  try {
    assertManagementOperationActive('create', signal);
    const ports = createManagedAgentAuthorityPorts('create', definition, staged);
    const authority = await initializeManagedAgentAuthority(
      identity,
      config,
      ports,
      definition.config.codec,
      staged.resumed
    );
    assertManagementOperationActive('create', signal);
    const namespaceCandidate = await definition.namespace.port.publish(staged);
    published = true;
    const namespace = validatePublishedNamespace('create', namespaceCandidate, identity.id);
    const projection = await publishCommittedManagedAgentProjection(
      definition,
      namespace,
      authority
    );
    return createManagedAgentCommitResult('create', authority, projection);
  } catch (cause: unknown) {
    if (!published) return await abortProvision(definition.namespace.port, staged, cause);
    throw cause;
  }
}
