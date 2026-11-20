import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow, type WorkflowDefinition } from '@print-an-agent/workflow-core';
import type { BaseAgentRunContext } from '../../src/index.js';

export type Run = BaseAgentRunContext<string, string>;
export type Definition<TInput = Run> = WorkflowDefinition<
  'entry' | 'child' | 'peer',
  TInput,
  { output?: string },
  undefined,
  string | undefined
>;

export function context(signal: AbortSignal = new AbortController().signal): Run {
  return {
    identity: defineAgentIdentity({ id: 'agent' }),
    operationName: 'request',
    runId: 'agent-run',
    input: 'input',
    signal,
    operations: { invoke: () => Promise.reject(new Error('No child Operations.')) },
  };
}
export function workflow<TInput = Run>(options: Partial<Definition<TInput>> = {}) {
  const step = { cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: false };
  return new Workflow<
    'entry' | 'child' | 'peer',
    TInput,
    { output?: string },
    undefined,
    string | undefined
  >({
    name: 'test',
    resources: undefined,
    entryStep: 'entry',
    createState: () => ({}),
    createResult: ({ output }) => output,
    createSkippedResult: () => undefined,
    stepDefinitions: {
      entry: {
        ...step,
        step: async (ctx) => {
          await ctx.runStep('child');
          ctx.state.output = 'output';
        },
      },
      child: { ...step, step: () => Promise.resolve() },
      peer: { ...step, step: () => Promise.resolve() },
    },
    ...options,
  });
}
