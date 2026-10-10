import { writeAgentConfig } from '@ta-agent/base-config';
import {
  defineAgentIdentity,
  disableAgentIdentity,
  parseAgentId,
  reactivateAgentIdentity,
} from '@ta-agent/base-identity';
import {
  createManagedAgentAuthority,
  createManagedAgentAuthorityPorts,
  initializeManagedAgentAuthority,
  readManagedAgentAuthority,
  type ManagedAgentAuthority,
} from './authority.js';
import { canonicalizeManagedAgentConfig, decodeManagedAgentConfig } from './config.js';
import type {
  CreateManagedAgentRequest,
  ImportManagedAgentConfigRequest,
  ManagedAgentCommitResult,
  ManagedAgentSnapshot,
  TransitionManagedAgentRequest,
  UpdateManagedAgentConfigRequest,
} from './contracts/agent-management.js';
import type {
  ManagedAgentNamespace,
  ManagedAgentNamespacePort,
  StagedManagedAgentNamespace,
} from './contracts/namespace.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { AgentManagementError, type AgentManagementOperation } from './errors.js';
import { summarizeManagementFailure } from './failures.js';
import {
  listManagedAgentNamespaces,
  resolveManagedAgentNamespace,
  validatePublishedNamespace,
  validateStagedNamespace,
} from './namespace.js';
import { assertManagementOperationActive } from './operation.js';
import {
  createManagedAgentCommitResult,
  createManagedAgentSnapshot,
  publishCommittedManagedAgentProjection,
  reconcileCommittedManagedAgentProjection,
  reconcileManagedAgentProjection,
} from './projection.js';

type Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> =
  ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>;

function validateExpectedRevision(
  operation: AgentManagementOperation,
  value: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AgentManagementError(
      'MANAGED_AGENT_REQUEST_INVALID',
      operation,
      `${label} must be a positive safe integer.`
    );
  }
  return value;
}

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

async function inspectNamespace<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  operation: AgentManagementOperation,
  definition: Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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

export async function createManagedAgent<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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

export async function inspectManagedAgent<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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

export async function listManagedAgents<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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

export async function updateManagedAgentConfig<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  operation: 'update-config' | 'import-config',
  definition: Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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

export function importManagedAgentConfig<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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

export async function transitionManagedAgent<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  operation: 'disable' | 'reactivate',
  definition: Definition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
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
