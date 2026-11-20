import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput } from '../../../src/index.js';
import { bindAgentWorkflow, createAgent, defineAgentOperation } from '../../../src/index.js';
import { cancellationError, type NumberRunContext, type StepName } from '../../support/agent.js';

it('propagates parent cancellation through an executor-local signal without aborting the source', async () => {
  const parentController = new AbortController();
  const executorController = new AbortController();
  const parentFailure = new Error('caller cancelled');
  let observedSignal: AbortSignal | undefined;
  let startWork: (() => void) | undefined;
  const workStarted = new Promise<void>((resolve) => {
    startWork = resolve;
  });
  const workflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<StepName, NumberRunContext, Record<never, never>, undefined, number>({
      name: 'parent-cancellation',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            observedSignal = context.signal;
            startWork?.();
            return new Promise((_resolve, reject) => {
              const cancel = (): void => reject(cancellationError(context.signal));
              if (context.signal.aborted) cancel();
              else context.signal.addEventListener('abort', cancel, { once: true });
            });
          },
        },
      },
      createState: () => ({}),
      createResult: () => 0,
    }),
    applyResult: () => Promise.resolve(),
  });
  const operation = defineAgentOperation({
    name: 'parentCancellation',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: ({ execute }) => execute(executorController.signal),
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
    operations: { parentCancellation: operation },
  });

  const invocation = agent.invoke('parentCancellation', 1, { signal: parentController.signal });
  await workStarted;
  parentController.abort(parentFailure);

  await expect(invocation).rejects.toBe(parentFailure);
  expect(observedSignal?.reason).toBe(parentFailure);
  expect(executorController.signal.aborted).toBe(false);
});

it('propagates executor-local cancellation without aborting the parent source', async () => {
  const started = Promise.withResolvers<void>();
  const parentController = new AbortController();
  const executorController = new AbortController();
  const localFailure = new Error('executor cancelled');
  let observedSignal: AbortSignal | undefined;
  const workflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<StepName, NumberRunContext, Record<never, never>, undefined, number>({
      name: 'executor-cancellation',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            observedSignal = context.signal;
            return new Promise((_resolve, reject) => {
              started.resolve();
              const cancel = (): void => reject(cancellationError(context.signal));
              if (context.signal.aborted) cancel();
              else context.signal.addEventListener('abort', cancel, { once: true });
            });
          },
        },
      },
      createState: () => ({}),
      createResult: () => 0,
    }),
    applyResult: () => Promise.resolve(),
  });
  const operation = defineAgentOperation({
    name: 'executorCancellation',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: async ({ execute }) => {
      const run = execute(executorController.signal);
      await started.promise;
      executorController.abort(localFailure);
      await run;
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
    operations: { executorCancellation: operation },
  });

  await expect(
    agent.invoke('executorCancellation', 1, { signal: parentController.signal })
  ).rejects.toBe(localFailure);
  expect(observedSignal?.reason).toBe(localFailure);
  expect(parentController.signal.aborted).toBe(false);
});
