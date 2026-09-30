import type { AgentIdentity } from '@ta-agent/base-identity';
import type { Agent } from '@ta-agent/base-workflow';
import type { ManagedAgentNamespace } from './namespace.js';

/** Creates product-owned runtime ports from an already resolved namespace. */
export type ManagedAgentRuntimePortFactory<TNamespaceHandle, TRuntimePorts> = (
  namespace: ManagedAgentNamespace<TNamespaceHandle>
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
