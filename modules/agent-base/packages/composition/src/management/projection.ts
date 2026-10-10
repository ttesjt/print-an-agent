import type { AgentConfigProjectionStatus } from './contracts/projection.js';
import type {
  ManagedAgentCommitResult,
  ManagedAgentMutationOperation,
  ManagedAgentProjectionOutcome,
  ManagedAgentSnapshot,
} from './contracts/agent-management.js';
import type { ManagedAgentNamespace } from './contracts/namespace.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { AgentManagementError, type AgentManagementOperation } from './errors.js';
import type { ManagedAgentAuthority } from './authority.js';

const NOT_CONFIGURED = Object.freeze({ kind: 'not-configured' as const });
const CURRENT = Object.freeze({ kind: 'current' as const });
const FAILED = Object.freeze({
  kind: 'failed' as const,
  failure: Object.freeze({ code: 'MANAGED_AGENT_PROJECTION_FAILED' as const }),
});

function projectionView<TConfig>(authority: ManagedAgentAuthority<TConfig>) {
  return Object.freeze({
    identity: authority.identity.identity,
    config: authority.config.value,
  });
}

function projectionFailure(operation: AgentManagementOperation): AgentManagementError {
  return new AgentManagementError(
    'MANAGED_AGENT_PROJECTION_FAILED',
    operation,
    'Managed Agent Config Projection coordination failed.'
  );
}

function validateProjectionStatus(
  operation: AgentManagementOperation,
  status: unknown
): AgentConfigProjectionStatus {
  if (typeof status !== 'object' || status === null || Array.isArray(status)) {
    throw projectionFailure(operation);
  }
  const keys = Reflect.ownKeys(status);
  const kind = Object.getOwnPropertyDescriptor(status, 'kind');
  if (
    keys.length !== 1 ||
    keys[0] !== 'kind' ||
    kind === undefined ||
    !Object.hasOwn(kind, 'value') ||
    (kind.value !== 'current' && kind.value !== 'stale')
  ) {
    throw projectionFailure(operation);
  }
  return kind.value === 'current' ? CURRENT : Object.freeze({ kind: 'stale' as const });
}

export async function publishManagedAgentProjection<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
>(
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
  namespace: ManagedAgentNamespace<TNamespaceHandle>,
  authority: ManagedAgentAuthority<TConfig>
): Promise<AgentConfigProjectionStatus> {
  const projection = definition.projection?.port;
  if (projection === undefined) return NOT_CONFIGURED;
  try {
    await projection.publish(namespace, projectionView(authority));
    return CURRENT;
  } catch {
    throw projectionFailure('create');
  }
}

export async function reconcileManagedAgentProjection<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
>(
  operation: AgentManagementOperation,
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
  namespace: ManagedAgentNamespace<TNamespaceHandle>,
  authority: ManagedAgentAuthority<TConfig>
): Promise<AgentConfigProjectionStatus> {
  const projection = definition.projection?.port;
  if (projection === undefined) return NOT_CONFIGURED;
  try {
    return validateProjectionStatus(
      operation,
      await projection.reconcile(namespace, projectionView(authority))
    );
  } catch (cause: unknown) {
    if (cause instanceof AgentManagementError) throw cause;
    throw projectionFailure(operation);
  }
}

export async function publishCommittedManagedAgentProjection<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
>(
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
  namespace: ManagedAgentNamespace<TNamespaceHandle>,
  authority: ManagedAgentAuthority<TConfig>
): Promise<ManagedAgentProjectionOutcome> {
  try {
    return await publishManagedAgentProjection(definition, namespace, authority);
  } catch {
    return FAILED;
  }
}

export async function reconcileCommittedManagedAgentProjection<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
>(
  operation: ManagedAgentMutationOperation,
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>,
  namespace: ManagedAgentNamespace<TNamespaceHandle>,
  authority: ManagedAgentAuthority<TConfig>
): Promise<ManagedAgentProjectionOutcome> {
  try {
    return await reconcileManagedAgentProjection(operation, definition, namespace, authority);
  } catch {
    return FAILED;
  }
}

export function createManagedAgentSnapshot<TConfig>(
  authority: ManagedAgentAuthority<TConfig>,
  projection: AgentConfigProjectionStatus
): ManagedAgentSnapshot<TConfig> {
  return Object.freeze({
    identity: authority.identity,
    config: authority.config,
    projection,
  });
}

export function createManagedAgentCommitResult<TConfig>(
  operation: ManagedAgentMutationOperation,
  authority: ManagedAgentAuthority<TConfig>,
  projection: ManagedAgentProjectionOutcome
): ManagedAgentCommitResult<TConfig> {
  return Object.freeze({
    status: 'committed',
    operation,
    authority: Object.freeze({
      identity: authority.identity,
      config: authority.config,
    }),
    projection,
  });
}
