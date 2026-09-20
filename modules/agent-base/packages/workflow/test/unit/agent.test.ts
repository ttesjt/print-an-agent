import { describe, expect, it } from 'vitest';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import type { AgentTraceEvent, AgentTraceEventSink } from '@ta-agent/base-observability';
import type {
  AgentDefinitionError,
  AgentRunContextFactoryInput,
  BaseAgentRunContext,
  BaseWorkflowContext,
} from '../../src/index.js';
import {
  createAgent,
  defineAgentOperation,
  defineAgentOperationReference,
  STEP_CARDINALITY,
  Workflow,
} from '../../src/index.js';

type StepName = 'execute';

interface TextRunContext extends BaseAgentRunContext<string, string> {
  readonly values: string[];
}

type TextWorkflowContext = BaseWorkflowContext<StepName, TextRunContext, string>;

class RecordingTraceSink implements AgentTraceEventSink {
  readonly events: AgentTraceEvent[] = [];

  record(event: AgentTraceEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

function textWorkflow(
  name: string,
  prefix: string
): Workflow<StepName, TextRunContext, TextWorkflowContext, string> {
  return new Workflow({
    name,
    entryStep: 'execute',
    stepDefinitions: {
      execute: {
        cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
        skippable: false,
        step: (context) => {
          context.result = `${prefix}:${context.agentRunContext.input}`;
          return Promise.resolve();
        },
      },
    },
    createContext: (base) => ({ ...base }),
    applyResult: (context, result) => {
      context.values.push(result);
      context.output = context.values.join('|');
      return Promise.resolve();
    },
  });
}

type NumberRunContext = BaseAgentRunContext<number, number>;
type NumberWorkflowContext = BaseWorkflowContext<StepName, NumberRunContext, number>;

function numberWorkflow(
  name: string
): Workflow<StepName, NumberRunContext, NumberWorkflowContext, number> {
  return new Workflow({
    name,
    entryStep: 'execute',
    stepDefinitions: {
      execute: {
        cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
        skippable: false,
        step: (context) => {
          context.result = context.agentRunContext.input * 2;
          return Promise.resolve();
        },
      },
    },
    createContext: (base) => ({ ...base }),
    applyResult: (context, result) => {
      context.output = result;
      return Promise.resolve();
    },
  });
}

function expectDefinitionError(run: () => unknown, code: AgentDefinitionError['code']): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected AgentDefinitionError with code ${code}.`);
}

describe('Agent Operations', () => {
  it('runs differently typed public Operations through one Agent owner', async () => {
    const text = textWorkflow('text', 'text');
    const number = numberWorkflow('number');
    const textOperation = defineAgentOperation({
      name: 'text',
      exposure: 'public',
      workflowPlan: [text],
      config: Object.freeze({}),
      resources: Object.freeze({}),
      createContext: (
        base: AgentRunContextFactoryInput<
          string,
          Readonly<Record<string, never>>,
          Readonly<Record<string, never>>,
          Readonly<Record<never, never>>
        >
      ): TextRunContext => ({ ...base, values: [] }),
    });
    const numberOperation = defineAgentOperation({
      name: 'number',
      exposure: 'public',
      workflowPlan: [number],
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
    const agent = createAgent({
      identity: defineAgentIdentity({ id: 'agent' }),
      resources: Object.freeze({}),
      operations: { text: textOperation, number: numberOperation },
    });

    await expect(agent.invoke('text', 'hello')).resolves.toBe('text:hello');
    await expect(agent.invoke('number', 4)).resolves.toBe(8);
    expect(agent.operationNames).toEqual(['text', 'number']);
    expect(agent.workflowCatalog.names).toEqual(['text', 'number']);
  });

  it('lets an Operation prepare its Run and map terminal errors without an outer facade', async () => {
    const failure = new Error('raw failure');
    const mappedFailure = new Error('mapped failure');
    const preparedSignal = new AbortController().signal;
    let observedInput: string | undefined;
    let observedSignal: AbortSignal | undefined;
    const workflow = new Workflow<StepName, TextRunContext, TextWorkflowContext, string>({
      name: 'prepared-run',
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            observedInput = context.agentRunContext.input;
            observedSignal = context.agentRunContext.signal;
            return Promise.reject(failure);
          },
        },
      },
      createContext: (base) => ({ ...base }),
      applyResult: () => Promise.resolve(),
    });
    const operation = defineAgentOperation({
      name: 'prepared',
      exposure: 'public',
      workflowPlan: [workflow],
      config: Object.freeze({}),
      resources: Object.freeze({}),
      prepareRun: ({ input }) =>
        Promise.resolve(Object.freeze({ input: input.toUpperCase(), signal: preparedSignal })),
      mapRunError: (error, prepared) => {
        expect(error).toBe(failure);
        expect(prepared.input).toBe('HELLO');
        expect(prepared.signal).toBe(preparedSignal);
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

    await expect(agent.invoke('prepared', 'hello')).rejects.toBe(mappedFailure);
    expect(observedInput).toBe('HELLO');
    expect(observedSignal).toBe(preparedSignal);
  });

  it('reuses one Agent-owned Workflow in multiple Operation plans', async () => {
    const shared = textWorkflow('shared', 'shared');
    const extra = textWorkflow('extra', 'extra');
    const createContext = (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): TextRunContext => ({ ...base, values: [] });
    const standard = defineAgentOperation({
      name: 'standard',
      exposure: 'public',
      workflowPlan: [shared],
      config: Object.freeze({}),
      resources: Object.freeze({}),
      createContext,
    });
    const extended = defineAgentOperation({
      name: 'extended',
      exposure: 'public',
      workflowPlan: [shared, extra],
      config: Object.freeze({}),
      resources: Object.freeze({}),
      createContext,
    });
    const agent = createAgent({
      identity: defineAgentIdentity({ id: 'agent' }),
      resources: Object.freeze({}),
      operations: { standard, extended },
    });

    await expect(agent.invoke('standard', 'hello')).resolves.toBe('shared:hello');
    await expect(agent.invoke('extended', 'hello')).resolves.toBe('shared:hello|extra:hello');
    expect(agent.workflowCatalog.get('shared')).toBe(shared);
  });

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
    type ParentWorkflowContext = BaseWorkflowContext<StepName, ParentContext, string>;
    const parentWorkflow = new Workflow<StepName, ParentContext, ParentWorkflowContext, string>({
      name: 'parent-workflow',
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: async (context) => {
            const childResult = await context.agentRunContext.operations.invoke('child', 6);
            context.result = `child:${childResult}`;
          },
        },
      },
      createContext: (base) => ({ ...base }),
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

  it('rejects conflicting definitions for one Agent-owned Workflow name', () => {
    const first = textWorkflow('shared', 'first');
    const second = textWorkflow('shared', 'second');
    const createContext = (
      base: AgentRunContextFactoryInput<
        string,
        Readonly<Record<string, never>>,
        Readonly<Record<string, never>>,
        Readonly<Record<never, never>>
      >
    ): TextRunContext => ({ ...base, values: [] });
    const one = defineAgentOperation({
      name: 'one',
      exposure: 'public',
      workflowPlan: [first],
      config: Object.freeze({}),
      resources: Object.freeze({}),
      createContext,
    });
    const two = defineAgentOperation({
      name: 'two',
      exposure: 'public',
      workflowPlan: [second],
      config: Object.freeze({}),
      resources: Object.freeze({}),
      createContext,
    });
    expectDefinitionError(
      () =>
        createAgent({
          identity: defineAgentIdentity({ id: 'agent' }),
          resources: Object.freeze({}),
          operations: { one, two },
        }),
      'WORKFLOW_NAME_DUPLICATE'
    );
  });

  it('rejects mismatched Operation registration keys and callable references', () => {
    const workflow = numberWorkflow('number-workflow');
    const number = defineAgentOperation({
      name: 'number',
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
      ): NumberRunContext => ({ ...base }),
    });
    expectDefinitionError(
      () =>
        createAgent({
          identity: defineAgentIdentity({ id: 'agent' }),
          resources: Object.freeze({}),
          operations: { wrong: number },
        }),
      'AGENT_OPERATION_NAME_MISMATCH'
    );

    const forgedReference = defineAgentOperationReference<'number', number, number>('number');
    const callableOperations = Object.freeze({ number: forgedReference });
    type ParentContext = BaseAgentRunContext<string, string, typeof callableOperations> &
      Readonly<{ values: string[] }>;
    const parent = defineAgentOperation({
      name: 'parent',
      exposure: 'public',
      workflowPlan: [textWorkflow('parent-workflow', 'parent')],
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
      ): ParentContext => ({ ...base, values: [] }),
    });
    expectDefinitionError(
      () =>
        createAgent({
          identity: defineAgentIdentity({ id: 'agent' }),
          resources: Object.freeze({}),
          operations: { parent, number },
        }),
      'AGENT_OPERATION_REFERENCE_MISMATCH'
    );
  });

  it('rejects external invocation of an internal Operation', async () => {
    const workflow = numberWorkflow('internal-workflow');
    const internal = defineAgentOperation({
      name: 'internal',
      exposure: 'internal',
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
      ): NumberRunContext => ({ ...base }),
    });
    const agent = createAgent({
      identity: defineAgentIdentity({ id: 'agent' }),
      resources: Object.freeze({}),
      operations: { internal },
    });

    await expect(
      (agent.invoke as (name: string, input: number) => Promise<number>)('internal', 1)
    ).rejects.toMatchObject({ code: 'AGENT_OPERATION_NOT_PUBLIC' });
  });

  it('fails closed when an Operation invokes an undeclared target', async () => {
    type UndeclaredContext = BaseAgentRunContext<string, string>;
    type UnsafeInvoker = Readonly<{
      invoke(name: string, input: unknown): Promise<unknown>;
    }>;
    type UndeclaredWorkflowContext = BaseWorkflowContext<StepName, UndeclaredContext, string>;
    const workflow = new Workflow<StepName, UndeclaredContext, UndeclaredWorkflowContext, string>({
      name: 'undeclared-workflow',
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: async (context) => {
            const unsafeInvoker = context.agentRunContext.operations as unknown as UnsafeInvoker;
            await unsafeInvoker.invoke('hidden', 1);
            context.result = 'unreachable';
          },
        },
      },
      createContext: (base) => ({ ...base }),
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
    ): Workflow<StepName, C, BaseWorkflowContext<StepName, C, number>, number> {
      return new Workflow({
        name,
        entryStep: 'execute',
        stepDefinitions: {
          execute: {
            cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
            skippable: false,
            step: async (context) => {
              context.result = await invokeTarget(context.agentRunContext);
            },
          },
        },
        createContext: (base) => ({ ...base }),
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

    const noOutputWorkflow = new Workflow<
      StepName,
      NumberRunContext,
      NumberWorkflowContext,
      number
    >({
      name: 'no-output-workflow',
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            context.result = context.agentRunContext.input;
            return Promise.resolve();
          },
        },
      },
      createContext: (base) => ({ ...base }),
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
});
