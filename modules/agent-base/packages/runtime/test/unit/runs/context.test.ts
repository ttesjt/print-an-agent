import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput } from '../../../src/index.js';
import { bindAgentWorkflow, createAgent, defineAgentOperation } from '../../../src/index.js';
import {
  type NumberRunContext,
  numberWorkflow,
  type StepName,
  type TextRunContext,
  textWorkflow,
} from '../../support/agent.js';

it('creates isolated Agent Run Contexts for concurrent invocations', async () => {
  const observed = new Set<TextRunContext>();
  const workflow = textWorkflow('text', 'text');
  const operation = defineAgentOperation({
    name: 'text',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): TextRunContext => {
      const context = { ...base, values: [] };
      observed.add(context);
      return context;
    },
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { text: operation },
  });

  await Promise.all([agent.invoke('text', 'first'), agent.invoke('text', 'second')]);
  expect(observed.size).toBe(2);
  expect([...observed].map((context) => context.input).sort()).toEqual(['first', 'second']);
});

it('protects runtime-owned Context fields and requires an Operation output', async () => {
  const workflow = numberWorkflow('number-workflow');
  const replacing = defineAgentOperation({
    name: 'replacing',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): NumberRunContext => ({ ...base, runId: 'replaced' }),
  });
  const replacingAgent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { replacing },
  });
  await expect(replacingAgent.invoke('replacing', 1)).rejects.toMatchObject({
    code: 'AGENT_RUN_CONTEXT_BASE_REPLACED',
  });

  const noOutputWorkflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<
      StepName,
      NumberRunContext,
      { readonly input: NumberRunContext; output: number },
      undefined,
      number
    >({
      name: 'no-output-workflow',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            context.state.output = context.state.input.input;
            return Promise.resolve();
          },
        },
      },
      createState: ({ input }) => ({ input, output: 0 }),
      createResult: ({ output }) => output,
    }),
    applyResult: () => Promise.resolve(),
  });
  const missing = defineAgentOperation({
    name: 'missing',
    exposure: 'public',
    workflowPlan: [noOutputWorkflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): NumberRunContext => ({ ...base }),
  });
  const missingAgent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { missing },
  });
  await expect(missingAgent.invoke('missing', 1)).rejects.toMatchObject({
    code: 'AGENT_RUN_OUTPUT_MISSING',
  });
});
