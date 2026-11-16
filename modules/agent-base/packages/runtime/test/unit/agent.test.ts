import { Workflow, STEP_CARDINALITY } from '@print-an-agent/workflow-core';
import { bindAgentWorkflow, type AgentWorkflow } from '../../src/index.js';
import { describe, expect, it } from 'vitest';
import { defineAgentIdentity } from '@print-an-agent/base-identity';
import type { AgentTraceEvent, AgentTraceEventSink } from '@print-an-agent/base-observability';
import type {
  AgentDefinitionError,
  AgentRunContextFactoryInput,
  BaseAgentRunContext,
} from '../../src/index.js';
import {
  createAgent,
  defineAgentOperation,
  defineAgentOperationReference,
} from '../../src/index.js';

type StepName = 'execute';

interface TextRunContext extends BaseAgentRunContext<string, string> {
  readonly values: string[];
}

class RecordingTraceSink implements AgentTraceEventSink {
  readonly events: AgentTraceEvent[] = [];

  record(event: AgentTraceEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

function textWorkflow(name: string, prefix: string): AgentWorkflow<TextRunContext, string> {
  return bindAgentWorkflow({
    workflow: new Workflow<
      StepName,
      TextRunContext,
      { readonly input: TextRunContext },
      undefined,
      string
    >({
      name,
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            context.result = `${prefix}:${context.state.input.input}`;
            return Promise.resolve();
          },
        },
      },
      createState: ({ input }) => ({ input }),
      createResult: () => '',
    }),
    applyResult: (context, result) => {
      context.values.push(result);
      context.output = context.values.join('|');
      return Promise.resolve();
    },
  });
}

type NumberRunContext = BaseAgentRunContext<number, number>;

function numberWorkflow(name: string): AgentWorkflow<NumberRunContext, number> {
  return bindAgentWorkflow({
    workflow: new Workflow<
      StepName,
      NumberRunContext,
      { readonly input: NumberRunContext },
      undefined,
      number
    >({
      name,
      resources: undefined,
      entryStep: 'execute',
      stepDefinitions: {
        execute: {
          cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
          skippable: false,
          step: (context) => {
            context.result = context.state.input.input * 2;
            return Promise.resolve();
          },
        },
      },
      createState: ({ input }) => ({ input }),
      createResult: () => 0,
    }),
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

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Run cancelled.', { cause: signal.reason });
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
    const parentSignal = new AbortController().signal;
    let preparationSignal: AbortSignal | undefined;
    let observedInput: string | undefined;
    let observedSignal: AbortSignal | undefined;
    let mappedSignal: AbortSignal | undefined;
    const workflow = bindAgentWorkflow({
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

  it('preserves the authoritative protocol failure when an earlier parent cancellation wins the effective signal', async () => {
    const started = Promise.withResolvers<void>();
    let cancellationReason: unknown;
    let workSettled = false;
    const parentController = new AbortController();
    const executorController = new AbortController();
    const parentFailure = new Error('caller cancelled');
    const workflow = bindAgentWorkflow({
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

  it('locks a concurrent reentry violation even when the executor catches it', async () => {
    const started = Promise.withResolvers<void>();
    let activeRunCancelled = false;
    const workflow = bindAgentWorkflow({
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

    const parentWorkflow = bindAgentWorkflow({
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
              const childResult = await context.state.input.operations.invoke('child', 6);
              context.result = `child:${childResult}`;
            },
          },
        },
        createState: ({ input }) => ({ input }),
        createResult: () => '',
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
      workflow: new Workflow<
        StepName,
        ParentContext,
        { readonly input: ParentContext },
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
              context.result = 'unreachable';
            },
          },
        },
        createState: ({ input }) => ({ input }),
        createResult: () => '',
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

    const workflow = bindAgentWorkflow({
      workflow: new Workflow<
        StepName,
        UndeclaredContext,
        { readonly input: UndeclaredContext },
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
              context.result = 'unreachable';
            },
          },
        },
        createState: ({ input }) => ({ input }),
        createResult: () => '',
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
        workflow: new Workflow<StepName, C, { readonly input: C }, undefined, number>({
          name,
          resources: undefined,
          entryStep: 'execute',
          stepDefinitions: {
            execute: {
              cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
              skippable: false,
              step: async (context) => {
                context.result = await invokeTarget(context.state.input);
              },
            },
          },
          createState: ({ input }) => ({ input }),
          createResult: () => 0,
        }),
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

    const noOutputWorkflow = bindAgentWorkflow({
      workflow: new Workflow<
        StepName,
        NumberRunContext,
        { readonly input: NumberRunContext },
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
              context.result = context.state.input.input;
              return Promise.resolve();
            },
          },
        },
        createState: ({ input }) => ({ input }),
        createResult: () => 0,
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
});
