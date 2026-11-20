import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput } from '../../../src/index.js';
import { bindAgentWorkflow, createAgent, defineAgentOperation } from '../../../src/index.js';
import { type NumberRunContext, type StepName, type TextRunContext } from '../../support/agent.js';

it('lets an Operation prepare its Run and map terminal errors without an outer facade', async () => {
  const failure = new Error('raw failure');
  const mappedFailure = new Error('mapped failure');
  const parentSignal = new AbortController().signal;
  let preparationSignal: AbortSignal | undefined;
  let observedInput: string | undefined;
  let observedSignal: AbortSignal | undefined;
  let mappedSignal: AbortSignal | undefined;
  const workflow = bindAgentWorkflow({
    projectInput: (context: TextRunContext) => context,
    workflow: new Workflow<
      StepName,
      TextRunContext,
      { readonly input: TextRunContext },
      undefined,
      string
    >({
      name: 'prepared-run',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            observedInput = context.state.input.input;
            observedSignal = context.state.input.signal;
            return Promise.reject(failure);
          },
        },
      },
      createState: ({ input }) => ({ input }),
      createResult: () => '',
    }),
    applyResult: () => Promise.resolve(),
  });
  const operation = defineAgentOperation({
    name: 'prepared',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    prepareRun: ({ input, signal }) => {
      preparationSignal = signal;
      return Promise.resolve(Object.freeze({ input: input.toUpperCase() }));
    },
    mapRunError: (error, prepared) => {
      expect(error).toBe(failure);
      expect(prepared.input).toBe('HELLO');
      mappedSignal = prepared.signal;
      return mappedFailure;
    },
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): TextRunContext => ({ ...base, values: [] }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { prepared: operation },
  });

  await expect(agent.invoke('prepared', 'hello', { signal: parentSignal })).rejects.toBe(
    mappedFailure
  );
  expect(observedInput).toBe('HELLO');
  expect(preparationSignal).toBe(parentSignal);
  expect(observedSignal).toBe(parentSignal);
  expect(mappedSignal).toBe(observedSignal);
});

it('rejects a Run preparation that attempts to replace the effective signal', async () => {
  let workflowStarted = false;
  const replacementSignal = new AbortController().signal;
  const workflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<StepName, NumberRunContext, Record<never, never>, undefined, number>({
      name: 'invalid-preparation',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: () => {
            workflowStarted = true;
            return Promise.resolve();
          },
        },
      },
      createState: () => ({}),
      createResult: () => 0,
    }),
    applyResult: () => Promise.resolve(),
  });
  const operation = defineAgentOperation({
    name: 'invalidPreparation',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    prepareRun: ({ input }) => Promise.resolve({ input, signal: replacementSignal } as never),
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): NumberRunContext => ({ ...base }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { invalidPreparation: operation },
  });

  await expect(agent.invoke('invalidPreparation', 1)).rejects.toMatchObject({
    code: 'AGENT_RUN_PREPARATION_INVALID',
  });
  expect(workflowStarted).toBe(false);
});
