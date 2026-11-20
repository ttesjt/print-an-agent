import type { AgentTraceEmitter } from '@print-an-agent/base-observability';

import { AgentRunError } from '../errors.js';

import type { AgentOperationDefinition } from '../operations/index.js';

import type { BaseAgentRunContext } from '../types/context.js';

import type { AgentOperationReferenceMap } from '../types/invocation.js';

import { createOperationInvoker } from './invocation.js';

import type { AgentRunEnvironment, InvocationLineage, OperationExecutionState } from './types.js';

export async function executeOperationPlan<
  TName extends string,
  TInput,
  TOutput,
  TConfig,
  TLocalResources,
  TCallableOperations extends AgentOperationReferenceMap,
  C extends BaseAgentRunContext<TInput, TOutput>,
>(
  environment: Pick<AgentRunEnvironment, 'identity' | 'resolveOperation'>,
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
      identity: environment.identity,
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

  const operations = createOperationInvoker(
    environment.resolveOperation,
    operation.callableOperations,
    Object.freeze({
      parentRunId: runId,
      operationNames: Object.freeze([...lineage.operationNames, operation.name]),
      signal: state.signal,
    })
  );
  const context = operation.createContext({
    identity: environment.identity,
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
    context.identity !== environment.identity ||
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

function isPreparedAgentOperationRun<TInput>(value: unknown): value is Readonly<{ input: TInput }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.ownKeys(value).length === 1 &&
    Object.hasOwn(value, 'input')
  );
}
