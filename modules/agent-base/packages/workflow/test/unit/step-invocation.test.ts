import { describe, expect, it } from 'vitest';
import { createAgentTraceEmitter, type AgentTraceEventDetails } from '@ta-agent/base-observability';
import { SKIP_STEP, STEP_CARDINALITY, type Step, type StepExecutor } from '../../src/index.js';
import {
  invocationRunContext,
  invocationWorkflow,
  type InvocationContext,
  type InvocationStepName,
} from '../support/invocation-workflow.js';

function traceRecorder() {
  const events: AgentTraceEventDetails[] = [];
  const emitter = createAgentTraceEmitter({
    agentId: 'agent',
    agentRunId: 'run',
    clock: () => 1,
    sink: {
      record: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  return {
    events,
    emitter,
    leafEvents: () =>
      events
        .filter((event) => 'stepName' in event && event.stepName === 'leaf')
        .map((event) => event.type),
  };
}

describe('Step logical invocations', () => {
  for (const cardinality of Object.values(STEP_CARDINALITY)) {
    it.each(['completed', 'failed', 'skipped'] as const)(
      `${cardinality} after %s`,
      async (outcome) => {
        const trace = traceRecorder();
        const executionNames: string[] = [];
        const failure = new Error('implementation failure');
        const leaf: Step<InvocationContext> = (context) => {
          context.calls++;
          return outcome === 'failed' ? Promise.reject(failure) : Promise.resolve();
        };
        const workflow = invocationWorkflow({
          executeStep: async ({ stepName, step, context }) => {
            executionNames.push(stepName);
            await step(context);
          },
          stepOverrides: {
            leaf: { cardinality, step: outcome === 'skipped' ? SKIP_STEP : leaf },
            entry: async (context) => {
              if (outcome === 'failed') await expect(context.runStep('leaf')).rejects.toBe(failure);
              else await context.runStep('leaf');
              if (cardinality === STEP_CARDINALITY.AT_MOST_ONCE) {
                await expect(context.runStep('leaf')).rejects.toMatchObject({
                  code: 'STEP_CARDINALITY_EXCEEDED',
                });
              } else if (outcome === 'failed') {
                await expect(context.runStep('leaf')).rejects.toBe(failure);
              } else await context.runStep('leaf');
              context.result = context.calls;
            },
          },
        });
        await workflow.run(invocationRunContext(trace.emitter));
        const count = cardinality === STEP_CARDINALITY.REPEATABLE ? 2 : 1;
        const lifecycle =
          outcome === 'skipped'
            ? ['step-skipped']
            : ['step-started', outcome === 'failed' ? 'step-failed' : 'step-completed'];
        expect(trace.leafEvents()).toEqual(Array.from({ length: count }, () => lifecycle).flat());
        expect(executionNames.filter((name) => name === 'leaf')).toHaveLength(
          outcome === 'skipped' ? 0 : count
        );
      }
    );

    it(`${cardinality} rejects overlapping execution and recursive invocation`, async () => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const trace = traceRecorder();
      const workflow = invocationWorkflow({
        stepOverrides: {
          leaf: {
            cardinality,
            step: async (context) => {
              await expect(context.runStep('leaf')).rejects.toMatchObject({
                code: 'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED',
              });
              started.resolve();
              await release.promise;
              context.calls++;
            },
          },
          entry: async (context) => {
            const first = context.runStep('leaf');
            try {
              await started.promise;
              await expect(context.runStep('leaf')).rejects.toMatchObject({
                code: 'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED',
              });
              // Different registered names are not locked by the running leaf or its parent.
              await context.runStep('other');
            } finally {
              release.resolve();
              await first;
            }
            context.result = context.calls;
          },
        },
      });
      await expect(workflow.run(invocationRunContext(trace.emitter))).resolves.toMatchObject({
        result: 2,
      });
      expect(trace.leafEvents()).toEqual(['step-started', 'step-completed']);
    });

    it.each(['step-started', 'step-completed', 'step-skipped'] as const)(
      `${cardinality} reserves through asynchronous %s tracing`,
      async (blockedType) => {
        const reached = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const events: string[] = [];
        const emitter = createAgentTraceEmitter({
          agentId: 'agent',
          agentRunId: 'run',
          clock: () => 1,
          sink: {
            record: async (event) => {
              if ('stepName' in event && event.stepName === 'leaf') {
                events.push(event.type);
                if (event.type === blockedType) {
                  reached.resolve();
                  await release.promise;
                }
              }
            },
          },
        });
        const workflow = invocationWorkflow({
          stepOverrides: {
            leaf: { cardinality, ...(blockedType === 'step-skipped' ? { step: SKIP_STEP } : {}) },
            entry: async (context) => {
              const first = context.runStep('leaf');
              try {
                await reached.promise;
                await expect(context.runStep('leaf')).rejects.toMatchObject({
                  code: 'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED',
                });
              } finally {
                release.resolve();
                await first;
              }
              context.result = context.calls;
            },
          },
        });
        await workflow.run(invocationRunContext(emitter));
        expect(events).toEqual(
          blockedType === 'step-skipped' ? ['step-skipped'] : ['step-started', 'step-completed']
        );
      }
    );
  }

  it('isolates invocation state across concurrent and subsequent Workflow Runs', async () => {
    const contexts = new Set<InvocationContext>();
    const bothStarted = Promise.withResolvers<void>();
    const workflow = invocationWorkflow({
      stepOverrides: {
        leaf: async (context) => {
          contexts.add(context);
          if (contexts.size >= 2) bothStarted.resolve();
          await bothStarted.promise;
          context.calls++;
        },
      },
    });
    const outcomes = await Promise.all([
      workflow.run(invocationRunContext()),
      workflow.run(invocationRunContext()),
    ]);
    expect(outcomes).toEqual([
      expect.objectContaining({ result: 1 }),
      expect.objectContaining({ result: 1 }),
    ]);
    await expect(workflow.run(invocationRunContext())).resolves.toMatchObject({ result: 1 });
    expect(contexts.size).toBe(3);
  });

  it('counts registered names independently even when they share a function', async () => {
    const shared: Step<InvocationContext> = (context) => {
      context.calls++;
      return Promise.resolve();
    };
    const workflow = invocationWorkflow({
      stepOverrides: {
        leaf: shared,
        other: shared,
        entry: async (context) => {
          await context.runStep('leaf');
          await context.runStep('other');
          context.result = context.calls;
        },
      },
    });
    await expect(workflow.run(invocationRunContext())).resolves.toMatchObject({ result: 2 });
  });

  it('lets a repeatable parent conditionally call a single-invocation child', async () => {
    const workflow = invocationWorkflow({
      stepOverrides: {
        parent: async (context) => {
          if (context.calls === 0) await context.runStep('leaf');
        },
        entry: async (context) => {
          await context.runStep('parent');
          await context.runStep('parent');
          context.result = context.calls;
        },
      },
    });
    await expect(workflow.run(invocationRunContext())).resolves.toMatchObject({ result: 1 });
  });

  it('does not reset a child when a repeatable parent is invoked again', async () => {
    const workflow = invocationWorkflow({
      stepOverrides: {
        entry: async (context) => {
          await context.runStep('parent');
          await context.runStep('parent');
          context.result = context.calls;
        },
      },
    });
    await expect(workflow.run(invocationRunContext())).rejects.toMatchObject({
      code: 'STEP_CARDINALITY_EXCEEDED',
      subjectName: 'leaf',
    });
  });

  it.each([false, true])(
    'keeps executor attempts inside one invocation (terminal failure: %s)',
    async (terminalFailure) => {
      const trace = traceRecorder();
      const failure = new Error('attempt failed');
      let attempts = 0;
      const executor: StepExecutor<InvocationStepName, InvocationContext> = async ({
        stepName,
        step,
        context,
      }) => {
        if (stepName !== 'leaf') return step(context);
        try {
          await step(context);
        } catch {
          await step(context);
        }
      };
      const workflow = invocationWorkflow({
        executeStep: executor,
        stepOverrides: {
          leaf: () => {
            attempts++;
            return attempts === 1 || terminalFailure ? Promise.reject(failure) : Promise.resolve();
          },
          entry: async (context) => {
            if (terminalFailure) await expect(context.runStep('leaf')).rejects.toBe(failure);
            else await context.runStep('leaf');
            await expect(context.runStep('leaf')).rejects.toMatchObject({
              code: 'STEP_CARDINALITY_EXCEEDED',
            });
            context.result = 0;
          },
        },
      });
      await workflow.run(invocationRunContext(trace.emitter));
      expect(attempts).toBe(2);
      expect(trace.leafEvents()).toEqual([
        'step-started',
        terminalFailure ? 'step-failed' : 'step-completed',
      ]);
    }
  );

  it('releases invocation state even when a supplied trace emitter throws', async () => {
    let shouldThrow = true;
    const traceFailure = new Error('trace emitter failure');
    const workflow = invocationWorkflow({
      stepOverrides: {
        leaf: { cardinality: STEP_CARDINALITY.REPEATABLE },
        entry: async (context) => {
          await expect(context.runStep('leaf')).rejects.toBe(traceFailure);
          await context.runStep('leaf');
          context.result = context.calls;
        },
      },
    });
    await expect(
      workflow.run(
        invocationRunContext({
          agentId: 'agent',
          agentRunId: 'run',
          record: (event) => {
            if (shouldThrow && event.type === 'step-started' && event.stepName === 'leaf') {
              shouldThrow = false;
              return Promise.reject(traceFailure);
            }
            return Promise.resolve();
          },
        })
      )
    ).resolves.toMatchObject({ result: 1 });
  });
});
