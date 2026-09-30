import type { AgentIdentity } from '@ta-agent/base-identity';
import type { ManagedAgentNamespace } from './namespace.js';

/** The typed authoritative view supplied to an optional external Config projection. */
export interface AgentConfigProjectionView<TConfig> {
  readonly identity: AgentIdentity;
  readonly config: TConfig;
}

export type ConfiguredAgentConfigProjectionStatus =
  | Readonly<{ kind: 'current' }>
  | Readonly<{ kind: 'stale' }>;

export type AgentConfigProjectionStatus =
  | Readonly<{ kind: 'not-configured' }>
  | ConfiguredAgentConfigProjectionStatus;

/** A medium-independent, one-way projection of authoritative Agent Config. */
export interface AgentConfigProjectionPort<TNamespaceHandle, TConfig> {
  publish(
    namespace: ManagedAgentNamespace<TNamespaceHandle>,
    view: AgentConfigProjectionView<TConfig>
  ): Promise<void>;
  reconcile(
    namespace: ManagedAgentNamespace<TNamespaceHandle>,
    view: AgentConfigProjectionView<TConfig>
  ): Promise<ConfiguredAgentConfigProjectionStatus>;
}
