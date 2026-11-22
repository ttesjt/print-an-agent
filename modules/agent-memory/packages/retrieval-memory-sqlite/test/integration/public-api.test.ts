import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as sqlite from '@print-an-agent/retrieval-memory-sqlite';

it('preserves the named public API and frozen native capabilities', () => {
  expect(Object.keys(sqlite).sort()).toEqual([
    'SQLITE_RETRIEVAL_LIMITS',
    'openSqliteRetrievalBackend',
  ]);
  expect(sqlite.SQLITE_RETRIEVAL_LIMITS).toEqual({
    maxDimensions: 8192,
    maxTopK: 4096,
    maxListLimit: 1000,
    busyTimeoutMs: 5000,
  });
  expect(Object.isFrozen(sqlite.SQLITE_RETRIEVAL_LIMITS)).toBe(true);
});

it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid busy timeout %s before starting a worker',
  async (busyTimeoutMs) => {
    await expect(
      sqlite.openSqliteRetrievalBackend({ path: ':memory:', busyTimeoutMs })
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  }
);

it('accepts zero timeout and preserves idempotent close', async () => {
  const backend = await sqlite.openSqliteRetrievalBackend({ path: ':memory:', busyTimeoutMs: 0 });
  try {
    expect(await backend.inspect('absent')).toBeUndefined();
  } finally {
    const closed = backend.close();
    expect(backend.close()).toBe(closed);
    await closed;
  }
});

it('reports initialization failure when the host has not supplied a parent directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'retrieval-open-'));
  try {
    await expect(
      sqlite.openSqliteRetrievalBackend({ path: join(directory, 'missing', 'memory.db') })
    ).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
      message: 'SQLite backend initialization failed.',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
