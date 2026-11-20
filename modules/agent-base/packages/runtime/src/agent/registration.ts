import { AgentDefinitionError } from '../errors.js';

import type {
  AgentOperationDefinition,
  AgentOperationDefinitionMap,
  AnyAgentOperationDefinition,
} from '../operations/index.js';

import type { InvocableAgentOperation, InvocationLineage } from '../runs/index.js';

import type { BaseAgentRunContext } from '../types/context.js';

import type { AgentOperationReferenceMap, AgentRunOptions } from '../types/invocation.js';

import type { AgentWorkflowCatalog, AnyAgentWorkflow } from '../workflows/index.js';

import { createAgentWorkflowCatalog } from '../workflows/index.js';

export interface RegisteredAgentOperation extends InvocableAgentOperation {
  readonly exposure: 'public' | 'internal';
  readonly reference: object;
}

export function createRegisteredOperation<
  TName extends string,
  TInput,
  TOutput,
  TConfig,
  TResources,
  TCallableOperations extends AgentOperationReferenceMap,
  C extends BaseAgentRunContext<TInput, TOutput>,
>(
  operation: AgentOperationDefinition<
    TName,
    TInput,
    TOutput,
    TConfig,
    TResources,
    TCallableOperations,
    C
  >,
  execute: (
    operation: AgentOperationDefinition<
      TName,
      TInput,
      TOutput,
      TConfig,
      TResources,
      TCallableOperations,
      C
    >,
    input: TInput,
    options: AgentRunOptions,
    lineage: InvocationLineage
  ) => Promise<TOutput>
): RegisteredAgentOperation {
  return Object.freeze({
    name: operation.name,
    exposure: operation.exposure,
    reference: operation.reference,
    execute: (input: unknown, options: AgentRunOptions, lineage: InvocationLineage) =>
      execute(operation, input as TInput, options, lineage),
  });
}
export interface RegisteredAgentOperations<TName extends string> {
  readonly byName: ReadonlyMap<string, RegisteredAgentOperation>;
  readonly byReference: ReadonlyMap<object, RegisteredAgentOperation>;
  readonly workflowCatalog: AgentWorkflowCatalog;
  readonly names: readonly TName[];
}
export function registerAgentOperations<TOperations extends AgentOperationDefinitionMap>(
  definitions: TOperations,
  execute: (
    operation: AnyAgentOperationDefinition,
    input: never,
    options: AgentRunOptions,
    lineage: InvocationLineage
  ) => Promise<unknown>
): RegisteredAgentOperations<keyof TOperations & string> {
  const byName = new Map<string, RegisteredAgentOperation>();
  const byReference = new Map<object, RegisteredAgentOperation>();

  const workflowsByName = new Map<string, AnyAgentWorkflow>();
  for (const value of Object.values(definitions)) {
    const operation = value as AnyAgentOperationDefinition;
    for (const workflow of operation.workflowPlan) {
      const registered = workflowsByName.get(workflow.name);
      if (registered !== undefined && registered !== workflow) {
        throw new AgentDefinitionError(
          'WORKFLOW_NAME_DUPLICATE',
          workflow.name,
          `Agent Workflow "${workflow.name}" has conflicting definitions across Operations.`
        );
      }
      workflowsByName.set(workflow.name, workflow);
    }
  }
  const workflowCatalog = createAgentWorkflowCatalog([...workflowsByName.values()]);

  for (const [registrationName, value] of Object.entries(definitions)) {
    const operation = value as AnyAgentOperationDefinition;
    if (operation.name !== registrationName) {
      throw new AgentDefinitionError(
        'AGENT_OPERATION_NAME_MISMATCH',
        registrationName,
        `Agent Operation registry key "${registrationName}" cannot resolve to Operation "${operation.name}".`
      );
    }
    const registered = createRegisteredOperation(
      operation,
      (
        target: typeof operation,
        input: never,
        options: AgentRunOptions,
        lineage: InvocationLineage
      ) => execute(target, input, options, lineage)
    );
    if (byReference.has(operation.reference)) {
      throw new AgentDefinitionError(
        'AGENT_OPERATION_REFERENCE_DUPLICATE',
        registrationName,
        `Agent Operation "${registrationName}" reuses another Operation reference.`
      );
    }
    byName.set(registrationName, registered);
    byReference.set(operation.reference, registered);
  }

  for (const value of Object.values(definitions)) {
    const operation = value as AnyAgentOperationDefinition;
    for (const [callName, reference] of Object.entries(operation.callableOperations)) {
      const target = byReference.get(reference);
      if (target === undefined || target.name !== callName) {
        throw new AgentDefinitionError(
          'AGENT_OPERATION_REFERENCE_MISMATCH',
          callName,
          `Agent Operation "${operation.name}" references an unregistered or mismatched callable Operation "${callName}".`
        );
      }
    }
  }

  const names = Object.freeze([...(Object.keys(definitions) as (keyof TOperations & string)[])]);
  return Object.freeze({ byName, byReference, workflowCatalog, names });
}
