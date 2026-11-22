import { DatabaseSync } from 'node:sqlite';

import { expect, it, vi } from 'vitest';

import { ContextMemoryError } from '@print-an-agent/context-memory';

import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';

import { borrowed } from '../../../support/fixtures.js';

it.each(['close', 'cancel'] as const)(
  'checks %s at asynchronous admission before dispatching native SQL',
  async (action) => {
    const { database, store } = borrowed();
    const controller = new AbortController();
    const query = vi.spyOn(database, 'prepare');
    try {
      const pending = store.read('m', controller.signal);
      expect(query).not.toHaveBeenCalled();
      if (action === 'close') store.close();
      else controller.abort();
      await expect(pending).rejects.toMatchObject({
        code: action === 'close' ? 'STORAGE_FAILED' : 'OPERATION_ABORTED',
      });
      expect(query).not.toHaveBeenCalled();
      expect(database.isOpen).toBe(true);
    } finally {
      query.mockRestore();
    }
  }
);

it('retains initialization and owned cleanup failures after releasing the native connection', () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Native fault injection forwards using the original explicit receiver.
  const exec = DatabaseSync.prototype.exec;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Native fault injection forwards using the original explicit receiver.
  const close = DatabaseSync.prototype.close;
  const execution = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
    this: DatabaseSync,
    sql: string
  ) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS context_memory_documents'))
      throw new Error('injected initialization failure');
    exec.call(this, sql);
  });
  const closing = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (
    this: DatabaseSync
  ) {
    close.call(this);
    throw new Error('injected cleanup failure');
  });
  try {
    let failure: unknown;
    try {
      new SqliteMemoryStore({ path: ':memory:' });
    } catch (cause) {
      failure = cause;
    }
    if (!(failure instanceof ContextMemoryError) || !(failure.cause instanceof AggregateError))
      throw new Error('Expected both initialization and cleanup evidence.');
    expect(failure.code).toBe('CLEANUP_FAILED');
    expect(failure.cause.errors).toMatchObject([
      { message: 'injected initialization failure' },
      { message: 'injected cleanup failure' },
    ]);
    expect(closing).toHaveBeenCalledTimes(1);
  } finally {
    execution.mockRestore();
    closing.mockRestore();
  }
});
