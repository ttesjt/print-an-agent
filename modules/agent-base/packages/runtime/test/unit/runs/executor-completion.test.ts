import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput } from '../../../src/index.js';
import { bindAgentWorkflow, createAgent, defineAgentOperation } from '../../../src/index.js';
import { type NumberRunContext, numberWorkflow, type StepName } from '../../support/agent.js';

it('lets an Operation executor wrap exactly one Run without owning its behavior', async () => {
  const parentSignal = new AbortController().signal;
  const executionSignal = new AbortController().signal;
  const config = Object.freeze({ boundary: 'request' });
  const resources = Object.freeze({ marker: 'resource' });
  let observedSignal: AbortSignal | undefined;
  const workflow = numberWorkflow('executed-run');
  const operation = defineAgentOperation({
    name: 'executed',
    exposure: 'public',
    workflowPlan: [workflow],
    config,
    resources,
    executeRun: (execution) => {
      expect(Object.isFrozen(execution)).toBe(true);
      expect(execution.input).toBe(3);
      expect(execution.signal).toBe(parentSignal);
      expect(execution.config).toBe(config);
      expect(execution.resources).toBe(resources);
      return execution.execute(executionSignal);
    },
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        typeof config,
        typeof resources,
        Readonly<Record<never, never>>
      >
    ): NumberRunContext => {
      observedSignal = base.signal;
      return { ...base };
    },
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { executed: operation },
  });

  await expect(agent.invoke('executed', 3, { signal: parentSignal })).resolves.toBe(6);
  expect(observedSignal).not.toBe(executionSignal);
  expect(observedSignal?.aborted).toBe(false);
});

it('rejects Operation executors that omit, repeat, or corrupt Run execution', async () => {
  const workflow = numberWorkflow('executor-invariant');
  const createContext = (
    base: AgentRunContextFactoryInput<
      number,
      Readonly<Record<string, never>>,
      Readonly<Record<string, never>>,
      Readonly<Record<never, never>>
    >
  ): NumberRunContext => ({ ...base });
  const omitted = defineAgentOperation({
    name: 'omitted',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: () => Promise.resolve(),
    createContext,
  });
  const repeated = defineAgentOperation({
    name: 'repeated',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: async ({ signal, execute }) => {
      await execute(signal);
      return execute(signal);
    },
    createContext,
  });
  const invalidSignal = defineAgentOperation({
    name: 'invalidSignal',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: ({ execute }) => execute({} as AbortSignal),
    createContext,
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { omitted, repeated, invalidSignal },
  });

  await expect(agent.invoke('omitted', 1)).rejects.toMatchObject({
    code: 'AGENT_RUN_EXECUTION_MISSING',
  });
  await expect(agent.invoke('repeated', 1)).rejects.toMatchObject({
    code: 'AGENT_RUN_EXECUTION_REENTERED',
  });
  await expect(agent.invoke('invalidSignal', 1)).rejects.toMatchObject({
    code: 'AGENT_RUN_EXECUTION_SIGNAL_INVALID',
  });
});

it('does not let an Operation executor swallow a Run failure', async () => {
  const failure = new Error('Run failed');
  const workflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<StepName, NumberRunContext, Record<never, never>, undefined, number>({
      name: 'failing-run',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: () => Promise.reject(failure),
        },
      },
      createState: () => ({}),
      createResult: () => 0,
    }),
    applyResult: () => Promise.resolve(),
  });
  const operation = defineAgentOperation({
    name: 'failing',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: async ({ signal, execute }) => {
      try {
        await execute(signal);
      } catch {
        // An executor owns the boundary, not the authoritative Run outcome.
      }
    },
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
    operations: { failing: operation },
  });

  await expect(agent.invoke('failing', 1)).rejects.toBe(failure);
});
