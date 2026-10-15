import { expect, it, vi } from 'vitest';
import { Workflow } from '@ta-agent/workflow-core';
import { execution, gate, onAbort, runOptions, causes, type Context } from './support/execution.js';

it.each(['result', 'condition', 'state'] as const)(
  'external ownership covers %s construction failure',
  async (phase) => {
    const close = vi.fn();
    const failure = new Error('construction failure');
    const hook = vi.fn();
    const flow = new Workflow<'main', void, void, { close(): void }, void>({
      name: 'construction',
      entryStep: 'main',
      createResult: () => {
        if (phase === 'result') throw failure;
      },
      createState: () => {
        if (phase === 'state') throw failure;
      },
      condition: () => {
        if (phase === 'condition') throw failure;
        return { status: 'run' };
      },
      stepDefinitions: {
        main: { skippable: false, cardinality: 'at-most-once', step: () => Promise.resolve() },
      },
      lifecycle: { onFinally: hook },
    });
    const owned = async () => {
      try {
        await flow.run({ ...runOptions, resources: { close } });
      } finally {
        close();
      }
    };
    await expect(owned()).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(1);
    expect(hook).not.toHaveBeenCalled();
  }
);

it('leaves a shared database open for a later run and has no automatic release rights', async () => {
  const close = vi.fn();
  let writes = 0;
  const resources = {
    close,
    write: () => {
      writes++;
      return Promise.resolve();
    },
  };
  const flow = new Workflow<'write', void, void, typeof resources, void>({
    name: 'borrowed',
    entryStep: 'write',
    createState: () => undefined,
    createResult: () => undefined,
    stepDefinitions: {
      write: { skippable: false, cardinality: 'at-most-once', step: (c) => c.resources.write() },
    },
  });
  await flow.run({ ...runOptions, resources });
  await flow.run({ ...runOptions, resources });
  expect(writes).toBe(2);
  expect(close).not.toHaveBeenCalled();
});

it('keeps the original failure plus parent-resource and Workflow cleanup failures', async () => {
  const original = new Error('read');
  const release = new Error('lease-release');
  const final = new Error('workflow-finally');
  const both = gate();
  let count = 0;
  const peer = async (c: Context) => {
    if (++count === 2) both.resolve();
    await onAbort(c.signal);
    c.signal.throwIfAborted();
  };
  const flow = execution(
    async (c) => {
      let primary: unknown;
      try {
        await c.parallel(['left', 'right']);
      } catch (error) {
        primary = error;
      }
      // The resource owner preserves both errors. A plain JS finally throw would hide primary.
      throw new AggregateError([primary, release], 'operation and lease release failed', {
        cause: primary,
      });
    },
    {
      left: async () => {
        if (++count === 2) both.resolve();
        await both.promise;
        throw original;
      },
      right: peer,
    },
    {
      onFinally: () => {
        throw final;
      },
    }
  );
  await expect(flow.run(runOptions)).rejects.toSatisfy((error: unknown) => {
    expect(causes(error)).toEqual([original, release, final]);
    return true;
  });
});

it('does not roll back a committed port write when later cleanup fails', async () => {
  let committed = 0;
  const cleanup = new Error('cleanup');
  const flow = execution(
    (c) => {
      committed++;
      c.result.push('committed');
      return Promise.resolve();
    },
    {},
    {
      onFinally: () => {
        throw cleanup;
      },
    }
  );
  await expect(flow.run(runOptions)).rejects.toBe(cleanup);
  expect(committed).toBe(1);
});

it('joins peers before parent resource release when caller aborts and a child has a distinct cleanup failure', async () => {
  const started = gate();
  let count = 0;
  const exits: string[] = [];
  const cleanup = new Error('child cleanup');
  const parent = new AbortController();
  const child = async (c: Context, label: string) => {
    if (++count === 2) started.resolve();
    await onAbort(c.signal);
    exits.push(label);
    if (label === 'left') throw cleanup;
    c.signal.throwIfAborted();
  };
  const flow = execution(
    async (c) => {
      try {
        await c.parallel(['left', 'right']);
      } finally {
        exits.push('parent-release');
      }
    },
    {
      left: (c) => child(c, 'left'),
      right: (c) => child(c, 'right'),
    }
  );
  const outcome = flow
    .run({ ...runOptions, signal: parent.signal })
    .catch((error: unknown) => error);
  await started.promise;
  parent.abort();
  const errors = causes(await outcome);
  expect(errors).toContain(cleanup);
  expect(errors).toContain(parent.signal.reason);
  expect(exits).toEqual(['left', 'right', 'parent-release']);
});
