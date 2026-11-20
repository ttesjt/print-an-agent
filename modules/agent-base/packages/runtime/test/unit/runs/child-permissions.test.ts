import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';
import { expect, it } from 'vitest';
import type { AgentRunContextFactoryInput, BaseAgentRunContext } from '../../../src/index.js';
import {
  bindAgentWorkflow,
  createAgent,
  defineAgentOperation,
  defineAgentOperationReference,
  type AgentWorkflow,
} from '../../../src/index.js';
import {
  type NumberRunContext,
  numberWorkflow,
  RecordingTraceSink,
  type StepName,
} from '../../support/agent.js';

it('provides only explicitly callable Operations and creates a correlated child Run', async () => {
  const trace = new RecordingTraceSink();
  const signal = new AbortController().signal;
  let childContext: NumberRunContext | undefined;
  const childWorkflow = numberWorkflow('child-workflow');
  const child = defineAgentOperation({
    name: 'child',
    exposure: 'internal',
    workflowPlan: [childWorkflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    createRunId: () => 'child-run',
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): NumberRunContext => {
      childContext = { ...base };
      return childContext;
    },
  });
  const callableOperations = Object.freeze({ child: child.reference });
  type ParentContext = BaseAgentRunContext<string, string, typeof callableOperations> &
    Readonly<{ values: string[] }>;

  const parentWorkflow = bindAgentWorkflow({
    projectInput: (context: ParentContext) => context,
    workflow: new Workflow<
      StepName,
      ParentContext,
      { readonly input: ParentContext; output: string },
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
            const childResult = await context.state.input.operations.invoke('child', 6);
            context.state.output = `child:${childResult}`;
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
    name: 'parent',
    exposure: 'public',
    workflowPlan: [parentWorkflow],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    callableOperations,
    createRunId: () => 'parent-run',
    createContext: (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        typeof callableOperations
      >
    ): ParentContext => ({ ...base, values: [] }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { parent, child },
    observability: { sink: trace, clock: () => 1 },
  });

  await expect(agent.invoke('parent', 'start', { signal })).resolves.toBe('child:12');
  expect(childContext).toMatchObject({
    identity: agent.identity,
    operationName: 'child',
    parentRunId: 'parent-run',
    signal,
  });
  const started = trace.events.filter((event) => event.type === 'agent-run-started');
  expect(started).toEqual([
    expect.objectContaining({ agentRunId: 'parent-run', operationName: 'parent' }),
    expect.objectContaining({
      agentRunId: 'child-run',
      operationName: 'child',
      parentRunId: 'parent-run',
    }),
  ]);
});

it('fails closed when an Operation invokes an undeclared target', async () => {
  type UndeclaredContext = BaseAgentRunContext<string, string>;
  type UnsafeInvoker = Readonly<{
    invoke(name: string, input: unknown): Promise<unknown>;
  }>;

  const workflow = bindAgentWorkflow({
    projectInput: (context: UndeclaredContext) => context,
    workflow: new Workflow<
      StepName,
      UndeclaredContext,
      { readonly input: UndeclaredContext; output: string },
      undefined,
      string
    >({
      name: 'undeclared-workflow',
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: async (context) => {
            const unsafeInvoker = context.state.input.operations as unknown as UnsafeInvoker;
            await unsafeInvoker.invoke('hidden', 1);
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
  const operation = defineAgentOperation({
    name: 'public',
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
    ): UndeclaredContext => ({ ...base }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { public: operation },
  });

  await expect(agent.invoke('public', 'start')).rejects.toMatchObject({
    code: 'AGENT_OPERATION_NOT_CALLABLE',
    subjectName: 'hidden',
  });
});

it('fails closed on a declared Operation invocation cycle', async () => {
  const firstReference = defineAgentOperationReference<'first', number, number>('first');
  const secondReference = defineAgentOperationReference<'second', number, number>('second');
  const firstCallable = Object.freeze({ second: secondReference });
  const secondCallable = Object.freeze({ first: firstReference });

  type FirstContext = BaseAgentRunContext<number, number, typeof firstCallable>;
  type SecondContext = BaseAgentRunContext<number, number, typeof secondCallable>;

  function callingWorkflow<C extends BaseAgentRunContext<number, number>>(
    name: string,
    invokeTarget: (context: C) => Promise<number>
  ): AgentWorkflow<C, number> {
    return bindAgentWorkflow({
      projectInput: (context: C) => context,
      workflow: new Workflow<StepName, C, { readonly input: C; output: number }, undefined, number>(
        {
          name,
          resources: undefined,
          entryStep: 'execute',
          stepDefinitions: {
            execute: {
              cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
              skippable: false,
              step: async (context) => {
                context.state.output = await invokeTarget(context.state.input);
              },
            },
          },
          createState: ({ input }) => ({ input, output: 0 }),
          createResult: ({ output }) => output,
        }
      ),
      applyResult: (context, result) => {
        context.output = result;
        return Promise.resolve();
      },
    });
  }

  const first = defineAgentOperation({
    name: 'first',
    exposure: 'public',
    reference: firstReference,
    workflowPlan: [
      callingWorkflow<FirstContext>('first-workflow', (context) =>
        context.operations.invoke('second', context.input)
      ),
    ],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    callableOperations: firstCallable,
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        typeof firstCallable
      >
    ): FirstContext => ({ ...base }),
  });
  const second = defineAgentOperation({
    name: 'second',
    exposure: 'internal',
    reference: secondReference,
    workflowPlan: [
      callingWorkflow<SecondContext>('second-workflow', (context) =>
        context.operations.invoke('first', context.input)
      ),
    ],
    config: Object.freeze({}),
    resources: Object.freeze({}),
    callableOperations: secondCallable,
    createContext: (
      base: AgentRunContextFactoryInput<
        number,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        typeof secondCallable
      >
    ): SecondContext => ({ ...base }),
  });
  const agent = createAgent({
    identity: defineAgentIdentity({ id: 'agent' }),
    resources: Object.freeze({}),
    operations: { first, second },
  });

  await expect(agent.invoke('first', 1)).rejects.toMatchObject({
    code: 'AGENT_OPERATION_INVOCATION_CYCLE',
    subjectName: 'first',
  });
});
