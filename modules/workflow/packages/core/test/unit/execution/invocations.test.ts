import { describe, expect, it } from 'vitest';
import { SKIP_STEP, STEP_CARDINALITY } from '@print-an-agent/workflow-core';
import { aborted, gate, leaves, once, options, workflow } from '../../support/fixtures.js';

describe('registered execution', () => {
  it('detects unfinished children at implementation return, before an executor can hide them', async () => {
    const started = gate();
    const release = gate();
    let child: Promise<void> | undefined;
    const flow = workflow(
      async (c) => {
        child = c.runStep('a');
        await started.promise;
      },
      {
        stepOverrides: {
          a: async (c) => {
            started.resolve();
            await Promise.race([release.promise, aborted(c.signal)]);
          },
        },
        executeStep: async ({ stepName, step, context }) => {
          await step(context);
          if (stepName === 'main') {
            release.resolve();
            await child;
          }
        },
      }
    );
    await expect(flow.run(options())).rejects.toMatchObject({
      code: 'WORKFLOW_EXECUTION_INCOMPLETE',
    });
  });
  it.each(['success', 'failure', 'skip'] as const)('counts at-most-once after %s', async (mode) => {
    const flow = workflow(
      async (c) => {
        try {
          await c.runStep('b');
        } catch {
          /* deliberately handled */
        }
        await expect(c.runStep('b')).rejects.toMatchObject({ code: 'STEP_CARDINALITY_EXCEEDED' });
      },
      {
        stepOverrides: {
          b:
            mode === 'skip'
              ? SKIP_STEP
              : () => {
                  if (mode === 'failure') throw new Error('handled');
                  return Promise.resolve();
                },
        },
      }
    );
    await expect(flow.run(options())).resolves.toEqual([]);
  });

  it('allows serial repeatable calls and keeps nested child counts', async () => {
    const flow = workflow(
      async (c) => {
        await c.runStep('b');
        await expect(c.runStep('b')).rejects.toMatchObject({ code: 'STEP_CARDINALITY_EXCEEDED' });
        await c.runStep('c');
        await c.runStep('c');
      },
      {
        stepOverrides: {
          b: { cardinality: STEP_CARDINALITY.REPEATABLE, step: (c) => c.runStep('a') },
          c: {
            cardinality: STEP_CARDINALITY.REPEATABLE,
            step: (c) => {
              c.state.values.push(8);
              return Promise.resolve();
            },
          },
        },
      }
    );
    expect(await flow.run(options())).toEqual([4, 8, 8]);
  });

  it.each([STEP_CARDINALITY.AT_MOST_ONCE, STEP_CARDINALITY.REPEATABLE])(
    'rejects same-name overlap and recursion for %s',
    async (cardinality) => {
      const release = gate();
      const started = gate();
      const flow = workflow(
        async (c) => {
          const first = c.runStep('a');
          await started.promise;
          await expect(c.runStep('a')).rejects.toMatchObject({
            code: 'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED',
          });
          release.resolve();
          await first;
        },
        {
          stepOverrides: {
            a: {
              cardinality,
              step: async (c) => {
                await expect(c.runStep('a')).rejects.toMatchObject({
                  code: 'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED',
                });
                started.resolve();
                await release.promise;
              },
            },
          },
        }
      );
      await flow.run(options());
    }
  );

  it('registers all names independently and permits Promise.all of different Steps', async () => {
    const started = gate();
    let count = 0;
    const shared = async () => {
      if (++count === 2) started.resolve();
      await started.promise;
    };
    await workflow(
      async (c) => {
        await Promise.all([c.runStep('a'), c.runStep('b')]);
      },
      { stepOverrides: { a: shared, b: shared } }
    ).run(options());
    expect(count).toBe(2);
  });

  it.each(['return', 'throw'] as const)(
    'joins a pending child when the entry exits with %s',
    async (mode) => {
      const entered = gate();
      const stopped = gate();
      const release = gate();
      const order: string[] = [];
      const primary = new Error('entry failure');
      const flow = workflow(
        async (c) => {
          void c.runStep('a');
          await entered.promise;
          if (mode === 'throw') throw primary;
        },
        {
          stepOverrides: {
            a: async (c) => {
              entered.resolve();
              await aborted(c.signal);
              order.push('cancel');
              stopped.resolve();
              await release.promise;
              order.push('child-finally');
              c.signal.throwIfAborted();
            },
          },
          lifecycle: {
            onFinally: () => {
              order.push('finally');
            },
          },
        }
      );
      const outcome = flow.run(options()).catch((error: unknown) => error);
      await stopped.promise;
      expect(order).toEqual(['cancel']);
      release.resolve();
      const error = await outcome;
      expect(order).toEqual(['cancel', 'child-finally', 'finally']);
      if (mode === 'throw') expect(leaves(error)).toContain(primary);
      else expect(leaves(error)[0]).toMatchObject({ code: 'WORKFLOW_EXECUTION_INCOMPLETE' });
    }
  );

  it('locks protocol errors even when a parent catches a premature composite return', async () => {
    const entered = gate();
    let caught = false;
    const flow = workflow(
      async (c) => {
        try {
          await c.runStep('b');
        } catch {
          caught = true;
        }
        c.state.values = [999];
      },
      {
        stepOverrides: {
          b: async (c) => {
            void c.runStep('a');
            await entered.promise;
          },
          a: async (c) => {
            entered.resolve();
            await aborted(c.signal);
            c.signal.throwIfAborted();
          },
        },
      }
    );
    await expect(flow.run(options())).rejects.toSatisfy((error: unknown) =>
      leaves(error).some(
        (e) => e instanceof Error && 'code' in e && e.code === 'WORKFLOW_EXECUTION_INCOMPLETE'
      )
    );
    expect(caught).toBe(true);
  });

  it('uses the custom executor for every active invocation and allows explicit serial retries', async () => {
    const executions: string[] = [];
    let attempts = 0;
    const flow = workflow((c) => c.runStep('a'), {
      stepOverrides: {
        a: (c) => {
          if (++attempts === 1) throw new Error('retry');
          c.state.values = [7];
          return Promise.resolve();
        },
      },
      executeStep: async ({ stepName, step, context }) => {
        executions.push(stepName);
        try {
          await step(context);
        } catch (error) {
          if (stepName !== 'a') throw error;
          await step(context);
        }
      },
    });
    expect(await flow.run(options())).toEqual([7]);
    expect(attempts).toBe(2);
    expect(executions).toEqual(['main', 'a']);
  });

  it('does not let an executor escape a pending attempt, even if it catches the eventual failure', async () => {
    const started = gate();
    const stopped = gate();
    const release = gate();
    let cleaned = false;
    const flow = workflow(
      async (c) => {
        started.resolve();
        await aborted(c.signal);
        stopped.resolve();
        await release.promise;
      },
      {
        executeStep: async ({ step, context }) => {
          void step(context).catch(() => undefined);
          await started.promise;
        },
        lifecycle: {
          onFinally: () => {
            cleaned = true;
          },
        },
      }
    );
    const outcome = flow.run(options()).catch((error: unknown) => error);
    await stopped.promise;
    expect(cleaned).toBe(false);
    release.resolve();
    expect(leaves(await outcome)[0]).toMatchObject({ code: 'STEP_EXECUTOR_INVALID' });
    expect(cleaned).toBe(true);
  });

  it('rejects missing attempts and preserves required entry semantics', async () => {
    const flow = workflow(() => Promise.resolve(), { executeStep: () => Promise.resolve() });
    await expect(flow.run(options())).rejects.toMatchObject({ code: 'STEP_EXECUTOR_INVALID' });
    expect(() =>
      workflow(() => Promise.resolve(), {
        stepDefinitions: { a: once(() => Promise.resolve()) } as never,
      })
    ).toThrow();
  });
});
