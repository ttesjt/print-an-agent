import type { AgentId, AgentIdentity } from '@ta-agent/base-identity';
import type { AgentTraceRuntimeOptions } from '@ta-agent/base-observability';
import type {
  AgentOperationDefinitionMap,
  AgentOperationInputFromDefinition,
  AgentOperationOutputFromDefinition,
  AgentRunOptions,
  PublicAgentOperationName,
} from './agent-operation.js';
import type { AgentWorkflowCatalog } from './workflow-catalog.js';

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
