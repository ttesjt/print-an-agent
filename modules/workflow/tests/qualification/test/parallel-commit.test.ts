import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { execution, gate, runOptions, type Context } from './support/execution.js';

it.each(['runStep', 'parallel'] as const)(
  '%s preserves a committed result when cancellation arrives before the child returns',
  async (dispatch) => {
    const database = new DatabaseSync(':memory:');
    const caller = new AbortController();
    database.exec('CREATE TABLE commits (value TEXT NOT NULL)');
    const flow = execution(
      (context) => (dispatch === 'parallel' ? context.parallel(['left']) : context.runStep('left')),
      {
        left: (context) => {
          context.signal.throwIfAborted();
          database.prepare('INSERT INTO commits (value) VALUES (?)').run('committed');
          context.state.visited.push('committed');
          caller.abort();
          return Promise.resolve();
        },
      }
    );

    try {
      await expect(flow.run({ ...runOptions, signal: caller.signal })).resolves.toEqual([
        'committed',
      ]);
      expect(database.prepare('SELECT value FROM commits').all()).toEqual([{ value: 'committed' }]);
    } finally {
      database.close();
    }
  }
);

it('preserves every successful child when cancellation arrives before the group joins', async () => {
  const database = new DatabaseSync(':memory:');
  const caller = new AbortController();
  const committed = gate();
  database.exec('CREATE TABLE commits (value TEXT NOT NULL)');
  const commit = async (context: Context, name: string) => {
    context.signal.throwIfAborted();
    database.prepare('INSERT INTO commits (value) VALUES (?)').run(name);
    context.state.visited.push(name);
    if (context.state.visited.length === 2) {
      caller.abort();
      committed.resolve();
    }
    await committed.promise;
  };
  const flow = execution((context) => context.parallel(['left', 'right']), {
    left: (context) => commit(context, 'left'),
    right: (context) => commit(context, 'right'),
  });

  try {
    await expect(flow.run({ ...runOptions, signal: caller.signal })).resolves.toEqual([
      'left',
      'right',
    ]);
    expect(database.prepare('SELECT value FROM commits ORDER BY value').all()).toEqual([
      { value: 'left' },
      { value: 'right' },
    ]);
  } finally {
    database.close();
  }
});

it.each(['runStep', 'parallel'] as const)(
  '%s still rejects cancellation before admitting a child',
  async (dispatch) => {
    const caller = new AbortController();
    const child = vi.fn(() => Promise.resolve());
    const flow = execution(
      (context) => {
        caller.abort();
        return dispatch === 'parallel' ? context.parallel(['left']) : context.runStep('left');
      },
      { left: child }
    );

    await expect(flow.run({ ...runOptions, signal: caller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(child).not.toHaveBeenCalled();
  }
);
