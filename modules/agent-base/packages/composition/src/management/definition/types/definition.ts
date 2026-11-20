import type { AgentManagementContext } from '../../agents/index.js';
import type {
  ContextMemoryManagementCapability,
  RetrievalMemoryManagementCapability,
} from '../../memory/index.js';
import type {
  ManagedAgentRuntimeMaterializationInput,
  ManagedAgentRuntimeMaterializer,
  ManagedAgentRuntimePortFactory,
  RawManagedAgent,
} from '../../runtime-materialization/index.js';
import type {
  SessionManagementCapability,
  SessionNavigationCapability,
} from '../../sessions/index.js';

interface ManagedAgentCompositionDefinitionInputShape<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
> extends AgentManagementContext<TConfig, TNamespaceHandle> {
  readonly runtime: Readonly<{
    createPorts: ManagedAgentRuntimePortFactory<TConfig, TNamespaceHandle, TRuntimePorts>;
    materialize: (
      input: ManagedAgentRuntimeMaterializationInput<TConfig, TRuntimePorts>
    ) => TAgent | Promise<TAgent>;
  }>;
}

type RawAgentConstraint<TAgent> = [RawManagedAgent<TAgent>] extends [never] ? never : unknown;

export type ManagedAgentCompositionDefinitionInput<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
> = ManagedAgentCompositionDefinitionInputShape<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  RawAgentConstraint<TAgent>;

export type SessionManagedAgentCompositionDefinitionInput<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionManagementPorts,
> = ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionManagementCapability<TNamespaceHandle, TSessionManagementPorts>;

export type SessionNavigationAgentCompositionDefinitionInput<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionNavigationPorts,
> = ManagedAgentCompositionDefinitionInput<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts>;

export interface ManagedAgentCompositionDefinition<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
> extends AgentManagementContext<TConfig, TNamespaceHandle> {
  readonly runtime: Readonly<{
    createPorts: ManagedAgentRuntimePortFactory<TConfig, TNamespaceHandle, TRuntimePorts>;
    materialize: ManagedAgentRuntimeMaterializer<TConfig, TRuntimePorts, TAgent>;
  }>;
}

export type SessionManagedAgentCompositionDefinition<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionManagementPorts,
> = ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionManagementCapability<TNamespaceHandle, TSessionManagementPorts>;

export type SessionNavigationAgentCompositionDefinition<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionNavigationPorts,
> = ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent> &
  SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts>;

/** Closed capability input vocabulary; capability combinations are inferred rather than enumerated. */
export interface ManagedAgentCompositionCapabilitiesInput<TNamespaceHandle> {
  readonly contextMemoryManagement?: ContextMemoryManagementCapability<TNamespaceHandle>['contextMemoryManagement'];
  readonly retrievalMemoryManagement?: RetrievalMemoryManagementCapability<TNamespaceHandle>['retrievalMemoryManagement'];
  readonly sessionManagement?: SessionManagementCapability<
    TNamespaceHandle,
    unknown
  >['sessionManagement'];
  readonly sessionNavigation?: SessionNavigationCapability<
    TNamespaceHandle,
    unknown
  >['sessionNavigation'];
}
