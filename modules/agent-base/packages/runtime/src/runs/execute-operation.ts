import { createAgentTraceEmitter, traceErrorCode } from '@print-an-agent/base-observability';

import { randomUUID } from 'node:crypto';

import { AgentRunError } from '../errors.js';

import type { AgentOperationDefinition } from '../operations/index.js';

import type { BaseAgentRunContext } from '../types/context.js';

import type { AgentOperationReferenceMap, AgentRunOptions } from '../types/invocation.js';

import { executeOperationPlan } from './execute-plan.js';

import {
  AgentOperationExecutionProtocol,
  type AgentOperationExecutorOutcome,
} from './executor-protocol.js';

import { resolveOperationParentSignal } from './signals.js';

import type { AgentRunEnvironment, InvocationLineage, OperationExecutionState } from './types.js';

export async function executeAgentOperation<
  TName extends string,
  TInput,
  TOutput,
  TConfig,
  TLocalResources,
  TCallableOperations extends AgentOperationReferenceMap,
  C extends BaseAgentRunContext<TInput, TOutput>,
>(
  environment: AgentRunEnvironment,
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
  const parentSignal = resolveOperationParentSignal(operation.name, lineage.signal, options.signal);
  const executionState: OperationExecutionState<TInput> = {
    input,
    signal: parentSignal,
  };
  const runId = operation.createRunId?.() ?? randomUUID();
  const traceEmitter = createAgentTraceEmitter({
    agentId: environment.resolveAgentId(),
    agentRunId: runId,
    ...environment.observability,
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
      return executeOperationPlan(
        environment,
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
            identity: environment.identity,
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
        identity: environment.identity,
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
