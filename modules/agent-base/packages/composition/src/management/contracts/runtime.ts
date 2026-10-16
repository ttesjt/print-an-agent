import type { AgentIdentity, AgentIdentitySnapshot } from '@ta-agent/base-identity';
import type { Agent } from '@ta-agent/base-runtime';
import type { ManagedAgentConfigSnapshot } from './agent-management.js';
import type { ManagedAgentNamespace } from './namespace.js';

/**
 * Authoritative context for profile-owned runtime resource provisioning.
 *
 * These snapshots supply the values subsequently passed to materialization; they do not promise
 * an atomic read across Identity and Config authorities. Revisions inform explicit profile policy,
 * not automatic caching or the identity of persistent resources.
 */
export interface ManagedAgentRuntimeProvisioningInput<TConfig, TNamespaceHandle> {
  readonly namespace: ManagedAgentNamespace<TNamespaceHandle>;
  readonly identity: AgentIdentitySnapshot;
  readonly config: ManagedAgentConfigSnapshot<TConfig>;
}

/** Creates or locates product-owned runtime ports after authority validation. */
export type ManagedAgentRuntimePortFactory<TConfig, TNamespaceHandle, TRuntimePorts> = (
  input: ManagedAgentRuntimeProvisioningInput<TConfig, TNamespaceHandle>
) => TRuntimePorts | Promise<TRuntimePorts>;

/**
 * The complete generic input to runtime materialization.
 *
 * Namespace handles are deliberately absent. Products project storage details into runtime ports
 * before the materializer is called.
 */
export interface ManagedAgentRuntimeMaterializationInput<TConfig, TRuntimePorts> {
  readonly identity: AgentIdentity;
  readonly config: TConfig;
  readonly ports: TRuntimePorts;
}

type AgentTypeArguments<TAgent> = [TAgent] extends [Agent<infer TAgentResources, infer TOperations>]
  ? readonly [TAgentResources, TOperations]
  : never;

export type RawManagedAgent<TAgent> = [AgentTypeArguments<TAgent>] extends [never] ? never : TAgent;

export type ManagedAgentRuntimeMaterializer<TConfig, TRuntimePorts, TAgent> = (
  input: ManagedAgentRuntimeMaterializationInput<TConfig, TRuntimePorts>
) => RawManagedAgent<TAgent> | Promise<RawManagedAgent<TAgent>>;
