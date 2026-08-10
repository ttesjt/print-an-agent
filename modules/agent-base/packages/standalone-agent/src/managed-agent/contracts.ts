import type { AgentConfigWriteAdapter } from '@ta-agent/base-config';
import type { AgentId, AgentIdentityCatalogPort } from '@ta-agent/base-identity';
import type { RequestJournalPort } from '@ta-agent/base-request';
import type { NavigableCompactableSessionPort } from '@ta-agent/base-session';
import type { StandaloneAgentManifest, StandaloneManifestProjectionStatus } from '../types.js';

export interface AgentResourceNamespace<TNamespace> {
  readonly agentId: AgentId;
  readonly handle: TNamespace;
}

export interface StagedAgentResourceNamespace<
  TNamespace,
> extends AgentResourceNamespace<TNamespace> {
  readonly resumed: boolean;
}

export interface AgentResourceNamespaceAdapter<TNamespace> {
  stage(agentId: AgentId): Promise<StagedAgentResourceNamespace<TNamespace>>;
  publish(
    namespace: StagedAgentResourceNamespace<TNamespace>
  ): Promise<AgentResourceNamespace<TNamespace>>;
  abort(namespace: StagedAgentResourceNamespace<TNamespace>): Promise<void>;
  resolve(agentId: AgentId): Promise<AgentResourceNamespace<TNamespace> | undefined>;
  list(): Promise<readonly AgentResourceNamespace<TNamespace>[]>;
}

export interface ManagedAgentAuthorityPorts {
  readonly identityCatalog: AgentIdentityCatalogPort;
  readonly config: AgentConfigWriteAdapter;
}

export interface ManagedAgentRuntimePorts {
  readonly session: NavigableCompactableSessionPort;
  readonly requestJournal: RequestJournalPort;
}

export interface ManagedAgentResourcePortFactory<TNamespace> {
  createAuthorityPorts(namespace: AgentResourceNamespace<TNamespace>): ManagedAgentAuthorityPorts;
  createRuntimePorts(namespace: AgentResourceNamespace<TNamespace>): ManagedAgentRuntimePorts;
}

export interface StandaloneManifestProjectionPort<TNamespace> {
  publish(
    namespace: AgentResourceNamespace<TNamespace>,
    manifest: StandaloneAgentManifest
  ): Promise<void>;
  reconcile(
    namespace: AgentResourceNamespace<TNamespace>,
    manifest: StandaloneAgentManifest
  ): Promise<StandaloneManifestProjectionStatus>;
}
