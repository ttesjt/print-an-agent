import { describe, expect, it } from 'vitest';
import { aborted, gate, leaves, options, workflow, type Context } from '../../support/fixtures.js';

describe('managed parallel', () => {
  it('starts peers concurrently and waits before the parent releases its resource', async () => {
    const started = gate();
    const failed = gate();
    const release = gate();
    const cancelled = gate();
    const primary = new Error('first child');
    const cleanup = new Error('peer cleanup');
    const order: string[] = [];
    const caller = new AbortController();
    let parent: Context | undefined;
    let child: Context | undefined;
    const flow = workflow(
      async (c) => {
        parent = c;
        try {
          await c.parallel(['a', 'b']);
        } finally {
          order.push('release-parent');
        }
      },
      {
        stepOverrides: {
          a: async () => {
            await started.promise;
            await failed.promise;
            throw primary;
          },
          b: async (c) => {
            child = c;
            started.resolve();
            await aborted(c.signal);
            cancelled.resolve();
            await release.promise;
            order.push('child-exit');
            throw cleanup;
          },
        },
      }
    );
    const outcome = flow
      .run({ ...options(), signal: caller.signal })
      .catch((error: unknown) => error);
    await started.promise;
    failed.resolve();
    await cancelled.promise;
    expect(order).toEqual([]);
    expect(child?.signal.aborted).toBe(true);
    expect(parent?.signal.aborted).toBe(false);
    expect(caller.signal.aborted).toBe(false);
    release.resolve();
    expect(leaves(await outcome)).toEqual([primary, cleanup]);
    expect(order).toEqual(['child-exit', 'release-parent']);
  });

  it('allows a parent to handle group failure and continue without a poisoned signal', async () => {
    const both = gate();
    let count = 0;
    const flow = workflow(
      async (c) => {
        try {
          await c.parallel(['a', 'b']);
        } catch {
          c.state.values = [8];
        }
        expect(c.signal.aborted).toBe(false);
        await c.runStep('c');
      },
      {
        stepOverrides: {
          a: async () => {
            if (++count === 2) both.resolve();
            await both.promise;
            throw new Error('recoverable');
          },
          b: async (c) => {
            if (++count === 2) both.resolve();
            await aborted(c.signal);
            c.signal.throwIfAborted();
          },
          c: (c) => {
            c.state.values.push(9);
            return Promise.resolve();
          },
        },
      }
    );
    expect(await flow.run(options())).toEqual([8, 9]);
  });

  it('propagates caller cancellation, joins delayed cleanup and never returns partial defaults', async () => {
    const both = gate();
    const release = gate();
    let count = 0;
    let cleanup = false;
    const parent = new AbortController();
    const child = async (c: Context) => {
      if (++count === 2) both.resolve();
      await aborted(c.signal);
      await release.promise;
      c.signal.throwIfAborted();
    };
    const flow = workflow((c) => c.parallel(['a', 'b']), {
      stepOverrides: { a: child, b: child },
      lifecycle: {
        onFinally: () => {
          cleanup = true;
        },
      },
    });
    const result = flow.run({ ...options(), signal: parent.signal });
    const checked = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await both.promise;
    parent.abort();
    expect(cleanup).toBe(false);
    release.resolve();
    await checked;
    expect(cleanup).toBe(true);
  });

  it('preserves independently failing siblings and does not duplicate the inducing failure', async () => {
    const first = new Error('a');
    const second = new Error('b');
    const both = gate();
    let count = 0;
    const child = async (error: Error) => {
      if (++count === 2) both.resolve();
      await both.promise;
      throw error;
    };
    const result = workflow((c) => c.parallel(['a', 'b']), {
      stepOverrides: { a: () => child(first), b: () => child(second) },
    }).run(options());
    await expect(result).rejects.toSatisfy((e: unknown) => {
      expect(leaves(e)).toEqual([first, second]);
      return true;
    });
  });

  it('supports empty groups and normal same-name overlap rejection', async () => {
    await workflow(async (c) => {
      await c.parallel([]);
      await c.parallel(['a']);
    }).run(options());
    await expect(workflow((c) => c.parallel(['a', 'a'])).run(options())).rejects.toSatisfy(
      (error: unknown) =>
        leaves(error).some(
          (e) =>
            e instanceof Error && 'code' in e && e.code === 'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED'
        )
    );
  });
});
