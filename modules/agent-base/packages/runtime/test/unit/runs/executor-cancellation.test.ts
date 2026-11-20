import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput } from '../../../src/index.js';
import { bindAgentWorkflow, createAgent, defineAgentOperation } from '../../../src/index.js';
import { type NumberRunContext, type StepName } from '../../support/agent.js';

it('preserves the authoritative protocol failure when an earlier parent cancellation wins the effective signal', async () => {
  const started = Promise.withResolvers<void>();
  let cancellationReason: unknown;
  let workSettled = false;
  const parentController = new AbortController();
  const executorController = new AbortController();
  const parentFailure = new Error('caller cancelled');
  const workflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<StepName, NumberRunContext, Record<never, never>, undefined, number>({
      name: 'unawaited-run',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) =>
            new Promise((_resolve, reject) => {
              started.resolve();
              const cancel = (): void => {
                cancellationReason = context.signal.reason;
                workSettled = true;
                reject(
                  context.signal.reason instanceof Error
                    ? context.signal.reason
                    : new Error('Run cancelled.', { cause: context.signal.reason })
                );
              };
              if (context.signal.aborted) cancel();
              else context.signal.addEventListener('abort', cancel, { once: true });
            }),
        },
      },
      createState: () => ({}),
      createResult: () => 0,
    }),
    applyResult: () => Promise.resolve(),
  });
  const operation = defineAgentOperation({
    name: 'unawaited',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: async ({ execute }) => {
      void execute(executorController.signal);
      await started.promise;
      parentController.abort(parentFailure);
      return Promise.resolve();
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
    operations: { unawaited: operation },
  });

  await expect(
    agent.invoke('unawaited', 1, { signal: parentController.signal })
  ).rejects.toMatchObject({
    code: 'AGENT_RUN_EXECUTION_INCOMPLETE',
  });
  expect(cancellationReason).toBe(parentFailure);
  expect(workSettled).toBe(true);
  expect(executorController.signal.aborted).toBe(false);
});

it('locks a concurrent reentry violation even when the executor catches it', async () => {
  const started = Promise.withResolvers<void>();
  let activeRunCancelled = false;
  const workflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<StepName, NumberRunContext, Record<never, never>, undefined, number>({
      name: 'concurrent-reentry',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) =>
            new Promise((_resolve, reject) => {
              started.resolve();
              const cancel = (): void => {
                activeRunCancelled = true;
                reject(
                  context.signal.reason instanceof Error
                    ? context.signal.reason
                    : new Error('Run cancelled.', { cause: context.signal.reason })
                );
              };
              if (context.signal.aborted) cancel();
              else context.signal.addEventListener('abort', cancel, { once: true });
            }),
        },
      },
      createState: () => ({}),
      createResult: () => 0,
    }),
    applyResult: () => Promise.resolve(),
  });
  const operation = defineAgentOperation({
    name: 'reentrant',
    exposure: 'public',
    workflowPlan: [workflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    executeRun: async ({ signal, execute }) => {
      const activeRun = execute(signal);
      await started.promise;
      try {
        await execute(signal);
      } catch {
        // A protocol failure cannot be converted back into success.
      }
      try {
        await activeRun;
      } catch {
        // Runtime drainage still owns the locked terminal failure.
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
    operations: { reentrant: operation },
  });

  await expect(agent.invoke('reentrant', 1)).rejects.toMatchObject({
    code: 'AGENT_RUN_EXECUTION_REENTERED',
  });
  expect(activeRunCancelled).toBe(true);
});
