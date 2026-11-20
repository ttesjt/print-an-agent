import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput, BaseAgentRunContext } from '../../../src/index.js';
import { bindAgentWorkflow, createAgent, defineAgentOperation } from '../../../src/index.js';
import {
  cancellationError,
  type NumberRunContext,
  numberWorkflow,
  type StepName,
} from '../../support/agent.js';

it('rejects an invalid child Operation signal with a stable Run error', async () => {
  const child = defineAgentOperation({
    name: 'child',
    exposure: 'internal',
    workflowPlan: [numberWorkflow('child-workflow')],
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
  const callableOperations = Object.freeze({ child: child.reference });
  type ParentContext = BaseAgentRunContext<string, string, typeof callableOperations>;

  const parent = defineAgentOperation({
    name: 'parent',
    exposure: 'public',
    workflowPlan: [
      bindAgentWorkflow({
        projectInput: (context: ParentContext) => context,
        workflow: new Workflow<
          StepName,
          ParentContext,
          { readonly input: ParentContext },
          undefined,
          string
        >({
          name: 'parent-workflow',
          resources: undefined,
          entryStep: 'execute',
          stepDefinitions: {
            execute: {
              cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
              skippable: false,
              step: async (context) => {
                await context.state.input.operations.invoke('child', 1, {
                  signal: {} as AbortSignal,
                });
              },
            },
          },
          createState: ({ input }) => ({ input }),
          createResult: () => '',
        }),
        applyResult: () => Promise.resolve(),
      }),
    ],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    callableOperations,
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        typeof callableOperations
      >
    ): ParentContext => ({ ...base }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { parent, child },
  });

  await expect(agent.invoke('parent', 'start')).rejects.toMatchObject({
    code: 'AGENT_RUN_EXECUTION_SIGNAL_INVALID',
    subjectName: 'child',
  });
});

it('retains inherited cancellation when a child Operation adds a local signal', async () => {
  const parentController = new AbortController();
  const childLocalController = new AbortController();
  const parentFailure = new Error('parent cancelled');
  let childSignal: AbortSignal | undefined;
  let startChild: (() => void) | undefined;
  const childStarted = new Promise<void>((resolve) => {
    startChild = resolve;
  });
  const childWorkflow = bindAgentWorkflow({
    projectInput: (context: NumberRunContext) => context,
    workflow: new Workflow<StepName, NumberRunContext, Record<never, never>, undefined, number>({
      name: 'cancellable-child',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            childSignal = context.signal;
            startChild?.();
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
  const child = defineAgentOperation({
    name: 'cancellableChild',
    exposure: 'internal',
    workflowPlan: [childWorkflow],
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
  const callableOperations = Object.freeze({ cancellableChild: child.reference });
  type ParentContext = BaseAgentRunContext<string, string, typeof callableOperations>;

  const parentWorkflow = bindAgentWorkflow({
    projectInput: (context: ParentContext) => context,
    workflow: new Workflow<
      StepName,
      ParentContext,
      { readonly input: ParentContext; output: string },
      undefined,
      string
    >({
      name: 'cancellable-parent',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: async (context) => {
            await context.state.input.operations.invoke('cancellableChild', 1, {
              signal: childLocalController.signal,
            });
            context.state.output = 'unreachable';
          },
        },
      },
      createState: ({ input }) => ({ input, output: '' }),
      createResult: ({ output }) => output,
    }),
    applyResult: (context, result) => {
      context.output = result;
      return Promise.resolve();
    },
  });
  const parent = defineAgentOperation({
    name: 'cancellableParent',
    exposure: 'public',
    workflowPlan: [parentWorkflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    callableOperations,
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        typeof callableOperations
      >
    ): ParentContext => ({ ...base }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { cancellableParent: parent, cancellableChild: child },
  });

  const invocation = agent.invoke('cancellableParent', 'start', {
    signal: parentController.signal,
  });
  await childStarted;
  parentController.abort(parentFailure);

  await expect(invocation).rejects.toBe(parentFailure);
  expect(childSignal?.reason).toBe(parentFailure);
  expect(childLocalController.signal.aborted).toBe(false);
});
