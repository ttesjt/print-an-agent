import { randomUUID } from 'node:crypto';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import type { AgentId, AgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  createAgentTraceEmitter,
  traceErrorCode,
  type AgentTraceEmitter,
  type AgentTraceRuntimeOptions,
} from '@print-an-agent/base-observability';
import type { AgentDefinition, RunnableAgent } from '../types/agent.js';
import type {
  AgentOperationDefinition,
  AgentOperationDefinitionMap,
  AgentOperationInput,
  AgentOperationInputFromDefinition,
  AgentOperationOutput,
  AgentOperationOutputFromDefinition,
  AgentOperationReferenceMap,
  AgentRunOptions,
  PublicAgentOperationName,
} from '../types/agent-operation.js';
import { AgentDefinitionError, AgentRunError } from '../types/errors.js';
import type { AgentWorkflowCatalog } from '../types/workflow-catalog.js';
import type { AnyAgentWorkflow } from '../types/workflow-catalog.js';
import {
  AgentOperationExecutionProtocol,
  type AgentOperationExecutorOutcome,
} from './agent-operation-execution.js';
import { composeExecutionSignal } from '@print-an-agent/workflow-core';
import { createAgentWorkflowCatalog } from './workflow-catalog.js';

interface InvocationLineage {
  readonly parentRunId?: string;
  readonly operationNames: readonly string[];
  readonly signal?: AbortSignal;
}

interface OperationExecutionState<TInput> {
  input: TInput;
  signal: AbortSignal;
}

function isPreparedAgentOperationRun<TInput>(value: unknown): value is Readonly<{ input: TInput }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.ownKeys(value).length === 1 &&
    Object.hasOwn(value, 'input')
  );
}

function resolveOperationParentSignal(
  operationName: string,
  lineageSignal: AbortSignal | undefined,
  invocationSignal: AbortSignal | undefined
): AbortSignal {
  if (
    (lineageSignal !== undefined && !(lineageSignal instanceof AbortSignal)) ||
    (invocationSignal !== undefined && !(invocationSignal instanceof AbortSignal))
  ) {
    throw new AgentRunError(
      'AGENT_RUN_EXECUTION_SIGNAL_INVALID',
      `Agent Operation "${operationName}" received an invalid invocation signal.`,
      operationName
    );
  }
  if (lineageSignal === undefined) return invocationSignal ?? new AbortController().signal;
  if (invocationSignal === undefined) return lineageSignal;
  return composeExecutionSignal([lineageSignal, invocationSignal]);
}

interface RegisteredAgentOperation {
  readonly name: string;
  readonly exposure: 'public' | 'internal';
  readonly reference: object;
  readonly execute: (
    input: unknown,
    options: AgentRunOptions,
    lineage: InvocationLineage
  ) => Promise<unknown>;
}

function createRegisteredOperation<
  TName extends string,
  TInput,
  TOutput,
  TConfig,
  TResources,
  TCallableOperations extends AgentOperationReferenceMap,
  C extends import('../types/context.js').BaseAgentRunContext<TInput, TOutput>,
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
  readonly #operationsByName = new Map<string, RegisteredAgentOperation>();
  readonly #operationsByReference = new Map<object, RegisteredAgentOperation>();

  constructor(definition: AgentDefinition<TResources, TOperations>) {
    this.identity = defineAgentIdentity(definition.identity);
    this.resources = definition.resources;
    this.operations = Object.freeze({ ...definition.operations });
    this.#observability = Object.freeze({ ...definition.observability });

    const workflowsByName = new Map<string, AnyAgentWorkflow>();
    for (const value of Object.values(definition.operations)) {
      const operation = value as import('../types/agent-operation.js').AnyAgentOperationDefinition;
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
    this.workflowCatalog = createAgentWorkflowCatalog([...workflowsByName.values()]);

    for (const [registrationName, value] of Object.entries(definition.operations)) {
      const operation = value as import('../types/agent-operation.js').AnyAgentOperationDefinition;
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
        ) => this.#executeOperation(target, input, options, lineage)
      );
      if (this.#operationsByReference.has(operation.reference)) {
        throw new AgentDefinitionError(
          'AGENT_OPERATION_REFERENCE_DUPLICATE',
          registrationName,
          `Agent Operation "${registrationName}" reuses another Operation reference.`
        );
      }
      this.#operationsByName.set(registrationName, registered);
      this.#operationsByReference.set(operation.reference, registered);
    }

    for (const value of Object.values(definition.operations)) {
      const operation = value as import('../types/agent-operation.js').AnyAgentOperationDefinition;
      for (const [callName, reference] of Object.entries(operation.callableOperations)) {
        const target = this.#operationsByReference.get(reference);
        if (target === undefined || target.name !== callName) {
          throw new AgentDefinitionError(
            'AGENT_OPERATION_REFERENCE_MISMATCH',
            callName,
            `Agent Operation "${operation.name}" references an unregistered or mismatched callable Operation "${callName}".`
          );
        }
      }
    }

    this.operationNames = Object.freeze([
      ...(Object.keys(definition.operations) as (keyof TOperations & string)[]),
    ]);
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

  async #executeOperation<
    TName extends string,
    TInput,
    TOutput,
    TConfig,
    TLocalResources,
    TCallableOperations extends AgentOperationReferenceMap,
    C extends import('../types/context.js').BaseAgentRunContext<TInput, TOutput>,
  >(
    operation: AgentOperationDefinition<
      TName,
      TInput,
      TOutput,
      TConfig,
      TLocalResources,
      TCallableOperations,
      C
    >,
    input: TInput,
    options: AgentRunOptions,
    lineage: InvocationLineage
  ): Promise<TOutput> {
    if (lineage.operationNames.includes(operation.name)) {
      throw new AgentRunError(
        'AGENT_OPERATION_INVOCATION_CYCLE',
        `Agent Operation "${operation.name}" cannot recursively invoke itself.`,
        operation.name
      );
    }
    const parentSignal = resolveOperationParentSignal(
      operation.name,
      lineage.signal,
      options.signal
    );
    const executionState: OperationExecutionState<TInput> = {
      input,
      signal: parentSignal,
    };
    const runId = operation.createRunId?.() ?? randomUUID();
    const traceEmitter = createAgentTraceEmitter({
      agentId: this.agentId,
      agentRunId: runId,
      ...this.#observability,
    });
    await traceEmitter.record({
      type: 'agent-run-started',
      operationName: operation.name,
      ...(lineage.parentRunId === undefined ? {} : { parentRunId: lineage.parentRunId }),
    });

    const execution = new AgentOperationExecutionProtocol<TOutput>({
      operationName: operation.name,
      containsCustomExecutor: operation.executeRun !== undefined,
      parentSignal,
      executePlan: (signal) => {
        executionState.signal = signal;
        return this.#executeOperationPlan(
          operation,
          input,
          runId,
          lineage,
          executionState,
          traceEmitter
        );
      },
    });

    try {
      let executorOutcome: AgentOperationExecutorOutcome = Object.freeze({ status: 'completed' });
      try {
        if (operation.executeRun === undefined) await execution.execute(executionState.signal);
        else {
          await operation.executeRun(
            Object.freeze({
              identity: this.identity,
              input,
              signal: executionState.signal,
              config: operation.config,
              resources: operation.resources,
              execute: execution.execute,
            })
          );
        }
      } catch (error: unknown) {
        executorOutcome = Object.freeze({ status: 'failed', error });
      }
      const output = await execution.settleExecutor(executorOutcome);
      await traceEmitter.record({ type: 'agent-run-completed', operationName: operation.name });
      return output;
    } catch (error: unknown) {
      const mappedError =
        operation.mapRunError?.(error, {
          identity: this.identity,
          input: executionState.input,
          signal: executionState.signal,
          config: operation.config,
          resources: operation.resources,
        }) ?? error;
      await traceEmitter.record({
        type: 'agent-run-failed',
        operationName: operation.name,
        errorCode: traceErrorCode(mappedError),
      });
      throw mappedError;
    }
  }

  async #executeOperationPlan<
    TName extends string,
    TInput,
    TOutput,
    TConfig,
    TLocalResources,
    TCallableOperations extends AgentOperationReferenceMap,
    C extends import('../types/context.js').BaseAgentRunContext<TInput, TOutput>,
  >(
    operation: AgentOperationDefinition<
      TName,
      TInput,
      TOutput,
      TConfig,
      TLocalResources,
      TCallableOperations,
      C
    >,
    input: TInput,
    runId: string,
    lineage: InvocationLineage,
    state: OperationExecutionState<TInput>,
    traceEmitter: AgentTraceEmitter
  ): Promise<TOutput> {
    if (operation.prepareRun !== undefined) {
      const prepared = await operation.prepareRun({
        identity: this.identity,
        input,
        signal: state.signal,
        config: operation.config,
        resources: operation.resources,
      });
      if (!isPreparedAgentOperationRun<TInput>(prepared)) {
        throw new AgentRunError(
          'AGENT_RUN_PREPARATION_INVALID',
          `Agent Operation "${operation.name}" returned an invalid Run preparation.`,
          operation.name
        );
      }
      state.input = prepared.input;
    }

    const operations = this.#createOperationInvoker(
      operation.callableOperations,
      Object.freeze({
        parentRunId: runId,
        operationNames: Object.freeze([...lineage.operationNames, operation.name]),
        signal: state.signal,
      })
    );
    const context = operation.createContext({
      identity: this.identity,
      operationName: operation.name,
      runId,
      ...(lineage.parentRunId === undefined ? {} : { parentRunId: lineage.parentRunId }),
      input: state.input,
      signal: state.signal,
      config: operation.config,
      resources: operation.resources,
      operations,
      traceEmitter,
    });
    if (
      context.identity !== this.identity ||
      context.operationName !== operation.name ||
      context.runId !== runId ||
      context.parentRunId !== lineage.parentRunId ||
      context.input !== state.input ||
      context.signal !== state.signal ||
      context.operations !== operations ||
      context.traceEmitter !== traceEmitter
    ) {
      throw new AgentRunError(
        'AGENT_RUN_CONTEXT_BASE_REPLACED',
        `Agent Run Context factory for Operation "${operation.name}" replaced runtime-owned base fields.`,
        operation.name
      );
    }

    for (const workflow of operation.workflowPlan) {
      const outcome = await workflow.run(context);
      await outcome.applyTo(context);
    }
    if (!Object.hasOwn(context, 'output')) {
      throw new AgentRunError(
        'AGENT_RUN_OUTPUT_MISSING',
        `Agent Operation "${operation.name}" completed without assigning Agent Run Context output.`,
        operation.name
      );
    }
    return context.output as TOutput;
  }

  #createOperationInvoker<TReferences extends AgentOperationReferenceMap>(
    references: TReferences,
    lineage: InvocationLineage
  ): import('../types/agent-operation.js').AgentOperationInvoker<TReferences> {
    return Object.freeze({
      invoke: <TName extends keyof TReferences & string>(
        name: TName,
        input: AgentOperationInput<TReferences[TName]>,
        options: AgentRunOptions = {}
      ): Promise<AgentOperationOutput<TReferences[TName]>> => {
        const reference = references[name];
        if (reference === undefined) {
          return Promise.reject(
            new AgentRunError(
              'AGENT_OPERATION_NOT_CALLABLE',
              `Agent Operation "${name}" is not callable from this Agent Run.`,
              name
            )
          );
        }
        const target = this.#operationsByReference.get(reference);
        if (target === undefined || target.name !== name) {
          return Promise.reject(
            new AgentRunError(
              'AGENT_OPERATION_NOT_CALLABLE',
              `Agent Operation "${name}" is not callable from this Agent Run.`,
              name
            )
          );
        }
        return target.execute(input, options, lineage) as Promise<
          AgentOperationOutput<TReferences[TName]>
        >;
      },
    });
  }
}

export function createAgent<TResources, const TOperations extends AgentOperationDefinitionMap>(
  definition: AgentDefinition<TResources, TOperations>
): Agent<TResources, TOperations> {
  return new Agent(definition);
}
