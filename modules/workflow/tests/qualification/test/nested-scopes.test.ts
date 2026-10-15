import { expect, it } from 'vitest';
import { causes, execution, gate, onAbort, runOptions, type Context } from './support/execution.js';

it('carries group cancellation into nested children while allowing recovery in a live parent', async () => {
  const started = gate();
  const primary = new Error('outer sibling failed');
  const signals: AbortSignal[] = [];
  let count = 0;
  const child = async (c: Context) => {
    signals.push(c.signal);
    if (++count === 2) started.resolve();
    await onAbort(c.signal);
    c.signal.throwIfAborted();
  };
  const flow = execution(
    async (c) => {
      try {
        await c.parallel(['group', 'other']);
      } catch (error) {
        expect(causes(error)).toEqual([primary]);
      }
      expect(c.signal.aborted).toBe(false);
      await c.runStep('after');
    },
    {
      group: (c) => c.parallel(['left', 'right']),
      left: child,
      right: child,
      other: async () => {
        await started.promise;
        throw primary;
      },
      after: (c) => {
        c.result.push('recovered');
        return Promise.resolve();
      },
    }
  );
  expect(await flow.run(runOptions)).toEqual(['recovered']);
  expect(signals).toHaveLength(2);
  expect(signals.every((s) => s.aborted && s.reason === primary)).toBe(true);
});

it('does not cancel an unrelated parallel branch when an inner group failure is handled', async () => {
  const started = gate();
  const keepAlive = gate();
  let otherSignal: AbortSignal | undefined;
  const error = new Error('inner failure');
  const flow = execution((c) => c.parallel(['group', 'other']), {
    group: async (c) => {
      try {
        await c.parallel(['left', 'right']);
      } catch {
        c.result.push('handled');
      }
      expect(c.signal.aborted).toBe(false);
      expect(otherSignal?.aborted).toBe(false);
      keepAlive.resolve();
    },
    left: async () => {
      await started.promise;
      throw error;
    },
    right: async (c) => {
      started.resolve();
      await onAbort(c.signal);
      c.signal.throwIfAborted();
    },
    other: async (c) => {
      otherSignal = c.signal;
      await keepAlive.promise;
      c.signal.throwIfAborted();
      c.result.push('other');
    },
  });
  expect(await flow.run(runOptions)).toEqual(['handled', 'other']);
});

it('awaits nested finally blocks on parent cancellation without closing borrowed resources', async () => {
  const started = gate();
  const cancelled = gate();
  const release = gate();
  let count = 0;
  const parent = new AbortController();
  const order: string[] = [];
  const leaf = async (c: Context) => {
    if (++count === 2) started.resolve();
    try {
      await onAbort(c.signal);
      cancelled.resolve();
      await release.promise;
      c.signal.throwIfAborted();
    } finally {
      order.push('leaf-finally');
    }
  };
  const flow = execution(
    async (c) => {
      try {
        await c.parallel(['group', 'other']);
      } finally {
        order.push('parent-resource-release');
      }
    },
    {
      group: async (c) => {
        try {
          await c.parallel(['left', 'right']);
        } finally {
          order.push('group-finally');
        }
      },
      left: leaf,
      right: leaf,
      other: async (c) => {
        await onAbort(c.signal);
        c.signal.throwIfAborted();
      },
    },
    {
      onFinally: () => {
        order.push('workflow-finally');
      },
    }
  );
  const outcome = flow
    .run({ ...runOptions, signal: parent.signal })
    .catch((error: unknown) => error);
  await started.promise;
  parent.abort();
  await cancelled.promise;
  expect(order).toEqual([]);
  release.resolve();
  expect(causes(await outcome)).toEqual([parent.signal.reason]);
  expect(order).toEqual([
    'leaf-finally',
    'leaf-finally',
    'group-finally',
    'parent-resource-release',
    'workflow-finally',
  ]);
});

it('rejects runners retained from completed child scopes, even while the parent is still active', async () => {
  let child: Context | undefined;
  const flow = execution(
    async (c) => {
      await c.runStep('left');
      if (child === undefined) throw new Error('Expected captured child.');
      await expect(child.runStep('right')).rejects.toMatchObject({ code: 'WORKFLOW_SCOPE_CLOSED' });
      await expect(child.parallel(['right'])).rejects.toMatchObject({
        code: 'WORKFLOW_SCOPE_CLOSED',
      });
      await c.runStep('right');
    },
    {
      left: (c) => {
        child = c;
        return Promise.resolve();
      },
      right: (c) => {
        c.result.push('only-parent');
        return Promise.resolve();
      },
    }
  );
  expect(await flow.run(runOptions)).toEqual(['only-parent']);
  await expect(child?.runStep('after')).rejects.toMatchObject({ code: 'WORKFLOW_SCOPE_CLOSED' });
});

it('does not report safe cleanup while a registered non-cooperative promise is still pending', async () => {
  const started = gate();
  const release = gate();
  const observed = gate();
  let cleaned = false;
  const flow = execution(
    async (c) => {
      void c.runStep('left');
      await started.promise;
    },
    {
      left: async (c) => {
        started.resolve();
        void onAbort(c.signal).then(() => observed.resolve());
        await release.promise;
      },
    },
    {
      onFinally: () => {
        cleaned = true;
      },
    }
  );
  const outcome = flow.run(runOptions).catch((error: unknown) => error);
  await observed.promise;
  expect(cleaned).toBe(false);
  release.resolve();
  expect(causes(await outcome)[0]).toMatchObject({ code: 'WORKFLOW_EXECUTION_INCOMPLETE' });
  expect(cleaned).toBe(true);
});

it('detects an unawaited parallel helper, cancels descendants, and rejects success', async () => {
  const started = gate();
  let count = 0;
  let exits = 0;
  const child = async (c: Context) => {
    if (++count === 2) started.resolve();
    await onAbort(c.signal);
    exits++;
    c.signal.throwIfAborted();
  };
  const flow = execution(
    async (c) => {
      void c.parallel(['left', 'right']);
      await started.promise;
    },
    { left: child, right: child }
  );
  await expect(flow.run(runOptions)).rejects.toMatchObject({
    code: 'WORKFLOW_EXECUTION_INCOMPLETE',
  });
  expect(exits).toBe(2);
});
