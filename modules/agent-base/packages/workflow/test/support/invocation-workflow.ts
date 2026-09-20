import { defineAgentIdentity } from '@ta-agent/base-identity';
import type { AgentTraceEmitter } from '@ta-agent/base-observability';
import {
  STEP_CARDINALITY,
  Workflow,
  type BaseAgentRunContext,
  type BaseWorkflowContext,
  type WorkflowDefinition,
} from '../../src/index.js';

export type InvocationStepName = 'entry' | 'parent' | 'leaf' | 'other';
export type InvocationRunContext = BaseAgentRunContext<void, number>;
export interface InvocationContext extends BaseWorkflowContext<
  InvocationStepName,
  InvocationRunContext,
  number
> {
  calls: number;
}
export type InvocationWorkflowDefinition = WorkflowDefinition<
  InvocationStepName,
  InvocationRunContext,
  InvocationContext,
  number
>;

export function invocationRunContext(traceEmitter?: AgentTraceEmitter): InvocationRunContext {
  return {
    identity: defineAgentIdentity({ id: 'agent' }),
    operationName: 'test',
    runId: 'run',
    input: undefined,
    signal: new AbortController().signal,
    operations: { invoke: () => Promise.reject(new Error('No child Operations.')) },
    ...(traceEmitter === undefined ? {} : { traceEmitter }),
  };
}

export function invocationWorkflow(options: Partial<InvocationWorkflowDefinition> = {}) {
  return new Workflow<InvocationStepName, InvocationRunContext, InvocationContext, number>({
    name: 'invocation-test',
    entryStep: 'entry',
    stepDefinitions: {
      entry: {
        cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
        skippable: false,
        step: async (context) => {
          await context.runStep('leaf');
          context.result = context.calls;
        },
      },
      parent: {
        cardinality: STEP_CARDINALITY.REPEATABLE,
        skippable: false,
        step: async (context) => {
          await context.runStep('leaf');
        },
      },
      leaf: {
        cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
        skippable: true,
        step: (context) => {
          context.calls++;
          return Promise.resolve();
        },
      },
      other: {
        cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
        skippable: false,
        step: (context) => {
          context.calls++;
          return Promise.resolve();
        },
      },
    },
    createContext: (base) => ({ ...base, calls: 0 }),
    applyResult: (context, result) => {
      context.output = result;
      return Promise.resolve();
    },
    ...options,
  });
}
