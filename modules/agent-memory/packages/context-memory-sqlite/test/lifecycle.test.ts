import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { ContextMemoryError } from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { domain } from './support/fixtures.js';

it('preserves transaction cleanup and native close failures independently', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const controller = new AbortController();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Fault injection calls the native method with an explicit receiver below.
  const exec = DatabaseSync.prototype.exec;
  const execution = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
    this: DatabaseSync,
    sql: string
  ) {
    if (sql === 'ROLLBACK') throw new Error('rollback failed');
    exec.call(this, sql);
    if (sql === 'BEGIN IMMEDIATE') controller.abort();
  });
  try {
    await expect(
      domain(store).mutations.create({ memoryId: 'm', requestId: 'create' }, controller.signal)
    ).rejects.toMatchObject({ code: 'CLEANUP_FAILED' });
    const closing = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementationOnce(() => {
      throw new Error('close failed');
    });
    try {
      let error: unknown;
      try {
        store.close();
      } catch (cause) {
        error = cause;
      }
      if (!(error instanceof ContextMemoryError) || !(error.cause instanceof AggregateError))
        throw new Error('Expected independent cleanup causes.');
      expect(error.cause.errors).toMatchObject([
        { code: 'CLEANUP_FAILED', commit: { status: 'unknown' } },
        { message: 'close failed' },
      ]);
      expect(error.commit).toMatchObject({ status: 'unknown' });
    } finally {
      closing.mockRestore();
    }
  } finally {
    execution.mockRestore();
    // The native connection is now released, but the historical rollback failure is still surfaced.
    expect(() => store.close()).toThrow(ContextMemoryError);
  }
});
