import { describe, expect, it } from 'vitest';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import { createAgentTraceEmitter, type AgentTraceEmitter } from '@ta-agent/base-observability';
import type {
  BaseAgentRunContext,
  BaseWorkflowContext,
  StepDefinitions,
  StepOverrides,
  WorkflowCondition,
  WorkflowDefinition,
} from '../../src/index.js';
import {
  createSequentialStep,
  RUN_WORKFLOW,
  SKIP_STEP,
  skipWorkflow,
  Workflow,
} from '../../src/index.js';

type TestStepName = 'workflow' | 'leaf' | 'optional' | 'finish';

interface TestAgentContext extends BaseAgentRunContext<string, string> {
  readonly applied: string[];
}

interface TestWorkflowContext extends BaseWorkflowContext<TestStepName, TestAgentContext, string> {
  readonly local: string[];
}

function agentRunContext(input = 'hello', traceEmitter?: AgentTraceEmitter): TestAgentContext {
  return {
    identity: defineAgentIdentity({ id: 'agent' }),
    operationName: 'test',
    runId: `agent-run-${input}`,
    input,
    signal: new AbortController().signal,
    operations: Object.freeze({
      invoke: () => Promise.reject(new Error('No callable Agent Operations.')),
    }),
    applied: [],
    ...(traceEmitter === undefined ? {} : { traceEmitter }),
  };
}

function steps(
  observed?: Set<TestWorkflowContext>
): StepDefinitions<TestStepName, TestWorkflowContext> {
  return {
    workflow: {
      step: createSequentialStep('leaf', 'optional', 'finish'),
      skippable: false,
    },
    leaf: {
      step: (context) => {
        observed?.add(context);
        context.local.push(`leaf:${context.agentRunContext.input}`);
        return Promise.resolve();
      },
      skippable: false,
    },
    optional: {
      step: (context) => {
        context.local.push('optional');
        return Promise.resolve();
      },
      skippable: true,
    },
    finish: {
      step: (context) => {
        context.result = context.local.join('|');
        return Promise.resolve();
      },
      skippable: false,
    },
  };
}

function createTestWorkflow(
  stepOverrides: StepOverrides<TestStepName, TestWorkflowContext> = {},
  definitionOverrides: Partial<
    WorkflowDefinition<TestStepName, TestAgentContext, TestWorkflowContext, string>
  > = {},
  observed?: Set<TestWorkflowContext>
): Workflow<TestStepName, TestAgentContext, TestWorkflowContext, string> {
  return new Workflow({
    name: 'chat',
    entryStep: 'workflow',
    stepDefinitions: steps(observed),
    stepOverrides,
    createContext: (base) => ({ ...base, local: [] }),
    applyResult: (context, result) => {
      context.applied.push(result);
      return Promise.resolve();
    },
    ...definitionOverrides,
  });
}

describe('Workflow', () => {
  it('propagates leaf overrides through default composite steps', async () => {
    const workflow = createTestWorkflow({
      leaf: (context) => {
        context.local.push('override');
        return Promise.resolve();
      },
    });
    const context = agentRunContext();

    const outcome = await workflow.run(context);

    expect(outcome).toMatchObject({ status: 'completed', result: 'override|optional' });
    if (outcome.status === 'completed') await outcome.applyTo(context);
    expect(context.applied).toEqual(['override|optional']);
  });

  it('supports explicit Step skip inside a Workflow', async () => {
    const workflow = createTestWorkflow({ optional: SKIP_STEP });

    await expect(workflow.run(agentRunContext())).resolves.toMatchObject({
      status: 'completed',
      result: 'leaf:hello',
    });
  });

  it('supports complete workflow-step replacement', async () => {
    const workflow = createTestWorkflow({
      workflow: (context) => {
        context.result = 'replacement';
        return Promise.resolve();
      },
    });

    await expect(workflow.run(agentRunContext())).resolves.toMatchObject({
      status: 'completed',
      result: 'replacement',
    });
  });

  it('evaluates its internal condition before creating Workflow Context', async () => {
    let contextCreations = 0;
    const condition: WorkflowCondition<TestAgentContext> = (context) =>
      Promise.resolve(context.input === 'skip' ? skipWorkflow('not applicable') : RUN_WORKFLOW);
    const workflow = createTestWorkflow(
      {},
      {
        condition,
        createContext: (base) => {
          contextCreations += 1;
          return { ...base, local: [] };
        },
      }
    );

    await expect(workflow.run(agentRunContext('skip'))).resolves.toEqual({
      status: 'skipped',
      workflowName: 'chat',
      reason: 'not applicable',
    });
    expect(contextCreations).toBe(0);
  });

  it('creates isolated Workflow Contexts for concurrent runs', async () => {
    const observed = new Set<TestWorkflowContext>();
    const workflow = createTestWorkflow({}, {}, observed);

    await Promise.all([
      workflow.run(agentRunContext('first')),
      workflow.run(agentRunContext('second')),
    ]);

    expect(observed.size).toBe(2);
    const contexts = [...observed];
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(contexts.map((context) => context.agentRunContext.input).sort()).toEqual([
      'first',
      'second',
    ]);
  });

  it('routes every active Step through its executor', async () => {
    const calls: TestStepName[] = [];
    const workflow = createTestWorkflow(
      {},
      {
        executeStep: async ({ stepName, step, context }) => {
          calls.push(stepName);
          await step(context);
        },
      }
    );

    await workflow.run(agentRunContext());

    expect(calls).toEqual(['workflow', 'leaf', 'optional', 'finish']);
  });

  it('runs success and finally lifecycle handlers after producing a result', async () => {
    const calls: string[] = [];
    const workflow = createTestWorkflow(
      {
        finish: (context) => {
          calls.push('step');
          context.result = 'result';
          return Promise.resolve();
        },
      },
      {
        lifecycle: {
          onSuccess: (context) => {
            calls.push(`success:${context.result}`);
            return Promise.resolve();
          },
          onFinally: (context) => {
            calls.push(`finally:${context.result}`);
            return Promise.resolve();
          },
        },
      }
    );

    await expect(workflow.run(agentRunContext())).resolves.toMatchObject({
      status: 'completed',
      result: 'result',
    });
    expect(calls).toEqual(['step', 'success:result', 'finally:result']);
  });

  it('passes the original failure to onError and always runs onFinally', async () => {
    const failure = new Error('step failed');
    const calls: string[] = [];
    const workflow = createTestWorkflow(
      {
        workflow: () => Promise.reject(failure),
      },
      {
        lifecycle: {
          onSuccess: () => {
            calls.push('success');
            return Promise.resolve();
          },
          onError: (_context, error) => {
            expect(error).toBe(failure);
            calls.push('error');
            return Promise.resolve();
          },
          onFinally: () => {
            calls.push('finally');
            return Promise.resolve();
          },
        },
      }
    );

    await expect(workflow.run(agentRunContext())).rejects.toBe(failure);
    expect(calls).toEqual(['error', 'finally']);
  });

  it('records Workflow failure after error and finally lifecycle handlers', async () => {
    const failure = new Error('private execution failure');
    const calls: string[] = [];
    const traceEmitter = createAgentTraceEmitter({
      agentId: 'agent',
      agentRunId: 'agent-run',
      clock: () => 1,
      sink: {
        record: (event) => {
          calls.push(`trace:${event.type}`);
          return Promise.resolve();
        },
      },
    });
    const workflow = createTestWorkflow(
      { workflow: () => Promise.reject(failure) },
      {
        lifecycle: {
          onError: () => {
            calls.push('error');
            return Promise.resolve();
          },
          onFinally: () => {
            calls.push('finally');
            return Promise.resolve();
          },
        },
      }
    );

    await expect(workflow.run(agentRunContext('hello', traceEmitter))).rejects.toBe(failure);
    expect(calls).toEqual([
      'trace:workflow-run-started',
      'trace:step-started',
      'trace:step-failed',
      'error',
      'finally',
      'trace:workflow-run-failed',
    ]);
  });

  it('runs onError and onFinally when onSuccess fails', async () => {
    const failure = new Error('success handler failed');
    const calls: string[] = [];
    const workflow = createTestWorkflow(
      {},
      {
        lifecycle: {
          onSuccess: () => {
            calls.push('success');
            return Promise.reject(failure);
          },
          onError: (_context, error) => {
            expect(error).toBe(failure);
            calls.push('error');
            return Promise.resolve();
          },
          onFinally: () => {
            calls.push('finally');
            return Promise.resolve();
          },
        },
      }
    );

    await expect(workflow.run(agentRunContext())).rejects.toBe(failure);
    expect(calls).toEqual(['success', 'error', 'finally']);
  });

  it('preserves execution, error-handler, and cleanup failures', async () => {
    const executionFailure = new Error('execution failed');
    const errorHandlerFailure = new Error('error handler failed');
    const cleanupFailure = new Error('cleanup failed');
    const workflow = createTestWorkflow(
      {
        workflow: () => Promise.reject(executionFailure),
      },
      {
        lifecycle: {
          onError: () => Promise.reject(errorHandlerFailure),
          onFinally: () => Promise.reject(cleanupFailure),
        },
      }
    );

    const error = await workflow.run(agentRunContext()).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      executionFailure,
      errorHandlerFailure,
      cleanupFailure,
    ]);
    expect((error as AggregateError).cause).toBe(executionFailure);
  });

  it('does not invoke lifecycle handlers for a condition-skipped Workflow', async () => {
    const calls: string[] = [];
    const workflow = createTestWorkflow(
      {},
      {
        condition: () => Promise.resolve(skipWorkflow('not applicable')),
        lifecycle: {
          onSuccess: () => {
            calls.push('success');
            return Promise.resolve();
          },
          onError: () => {
            calls.push('error');
            return Promise.resolve();
          },
          onFinally: () => {
            calls.push('finally');
            return Promise.resolve();
          },
        },
      }
    );

    await expect(workflow.run(agentRunContext())).resolves.toMatchObject({ status: 'skipped' });
    expect(calls).toEqual([]);
  });

  it('rejects a Context factory that replaces runtime-owned fields', async () => {
    const workflow = createTestWorkflow(
      {},
      {
        createContext: (base) => ({
          ...base,
          workflowRunId: 'replacement',
          local: [],
        }),
      }
    );

    await expect(workflow.run(agentRunContext())).rejects.toMatchObject({
      code: 'WORKFLOW_CONTEXT_BASE_REPLACED',
    });
  });

  it('fails if the entry Step does not produce a result', async () => {
    const workflow = createTestWorkflow({ workflow: () => Promise.resolve() });

    await expect(workflow.run(agentRunContext())).rejects.toMatchObject({
      code: 'WORKFLOW_RESULT_MISSING',
    });
  });

  it('prevents a result from being applied to another Agent Context', async () => {
    const workflow = createTestWorkflow();
    const source = agentRunContext('source');
    const outcome = await workflow.run(source);

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      await expect(outcome.applyTo(agentRunContext('target'))).rejects.toMatchObject({
        code: 'WORKFLOW_RESULT_CONTEXT_MISMATCH',
      });
    }
  });
});
