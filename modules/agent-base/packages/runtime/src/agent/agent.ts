import type { AgentId, AgentIdentity } from '@print-an-agent/base-identity-config/identity';

import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import type { AgentTraceRuntimeOptions } from '@print-an-agent/base-observability';

import { AgentRunError } from '../errors.js';

import type {
  AgentOperationDefinitionMap,
  AgentOperationInputFromDefinition,
  AgentOperationOutputFromDefinition,
  PublicAgentOperationName,
} from '../operations/index.js';

import { executeAgentOperation } from '../runs/index.js';

import type { AgentRunOptions } from '../types/invocation.js';

import type { AgentWorkflowCatalog } from '../workflows/index.js';

import type { RegisteredAgentOperation } from './registration.js';

import { registerAgentOperations } from './registration.js';

import type { AgentDefinition, RunnableAgent } from './types.js';

export class Agent<
  TResources,
  TOperations extends AgentOperationDefinitionMap,
> implements RunnableAgent<TOperations> {
  readonly identity: AgentIdentity;
  readonly resources: TResources;
  readonly workflowCatalog: AgentWorkflowCatalog;
  readonly operations: TOperations;
  readonly operationNames: readonly (keyof TOperations & string)[];

  readonly #observability: AgentTraceRuntimeOptions;
  readonly #operationsByName: ReadonlyMap<string, RegisteredAgentOperation>;
  readonly #operationsByReference: ReadonlyMap<object, RegisteredAgentOperation>;

  constructor(definition: AgentDefinition<TResources, TOperations>) {
    this.identity = defineAgentIdentity(definition.identity);
    this.resources = definition.resources;
    this.operations = Object.freeze({ ...definition.operations });
    this.#observability = Object.freeze({ ...definition.observability });
    const registered = registerAgentOperations(
      definition.operations,
      (target, input, options, lineage) =>
        executeAgentOperation(
          {
            identity: this.identity,
            resolveAgentId: () => this.agentId,
            observability: this.#observability,
            resolveOperation: (reference) => this.#operationsByReference.get(reference),
          },
          target,
          input,
          options,
          lineage
        )
    );
    this.workflowCatalog = registered.workflowCatalog;
    this.#operationsByName = registered.byName;
    this.#operationsByReference = registered.byReference;
    this.operationNames = registered.names;
  }

  get agentId(): AgentId {
    return this.identity.id;
  }

  invoke<TName extends PublicAgentOperationName<TOperations>>(
    operationName: TName,
    input: AgentOperationInputFromDefinition<TOperations[TName]>,
    options: AgentRunOptions = {}
  ): Promise<AgentOperationOutputFromDefinition<TOperations[TName]>> {
    const operation = this.#operationsByName.get(operationName);
    if (operation === undefined) {
      return Promise.reject(
        new AgentRunError(
          'AGENT_OPERATION_NOT_REGISTERED',
          `Agent Operation "${operationName}" is not registered for Agent "${this.agentId}".`,
          operationName
        )
      );
    }
    if (operation.exposure !== 'public') {
      return Promise.reject(
        new AgentRunError(
          'AGENT_OPERATION_NOT_PUBLIC',
          `Agent Operation "${operationName}" is not externally invocable.`,
          operationName
        )
      );
    }
    return operation.execute(input, options, {
      operationNames: Object.freeze([]),
    }) as Promise<AgentOperationOutputFromDefinition<TOperations[TName]>>;
  }
}

export function createAgent<TResources, const TOperations extends AgentOperationDefinitionMap>(
  definition: AgentDefinition<TResources, TOperations>
): Agent<TResources, TOperations> {
  return new Agent(definition);
}
