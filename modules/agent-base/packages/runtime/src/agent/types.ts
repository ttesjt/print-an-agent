import type { AgentId, AgentIdentity } from '@print-an-agent/base-identity-config/identity';

import type { AgentTraceRuntimeOptions } from '@print-an-agent/base-observability';

import type {
  AgentOperationDefinitionMap,
  AgentOperationInputFromDefinition,
  AgentOperationOutputFromDefinition,
  PublicAgentOperationName,
} from '../operations/index.js';

import type { AgentRunOptions } from '../types/invocation.js';

import type { AgentWorkflowCatalog } from '../workflows/index.js';

export interface AgentDefinition<TResources, TOperations extends AgentOperationDefinitionMap> {
  readonly identity: AgentIdentity;
  readonly resources: TResources;
  readonly operations: TOperations;
  readonly observability?: AgentTraceRuntimeOptions;
}

export interface RunnableAgent<TOperations extends AgentOperationDefinitionMap> {
  readonly identity: AgentIdentity;
  readonly agentId: AgentId;
  readonly workflowCatalog: AgentWorkflowCatalog;
  readonly operationNames: readonly (keyof TOperations & string)[];
  invoke<TName extends PublicAgentOperationName<TOperations>>(
    operationName: TName,
    input: AgentOperationInputFromDefinition<TOperations[TName]>,
    options?: AgentRunOptions
  ): Promise<AgentOperationOutputFromDefinition<TOperations[TName]>>;
}
