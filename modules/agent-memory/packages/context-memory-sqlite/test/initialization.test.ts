import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';

it('preserves a borrowed connection when schema initialization fails', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA query_only = ON');
    let error: unknown;
    try {
      new SqliteMemoryStore({ database });
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ code: 'STORAGE_FAILED' });
    expect(database.isOpen).toBe(true);
    expect(database.prepare('SELECT 1 AS n').get()?.n).toBe(1);
  } finally {
    database.close();
  }
});

it('refuses initialization inside a caller-owned transaction without aborting it', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('BEGIN');
    let error: unknown;
    try {
      new SqliteMemoryStore({ database });
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ code: 'STORAGE_FAILED' });
    expect(database.isTransaction).toBe(true);
    database.exec('ROLLBACK');
  } finally {
    database.close();
  }
});

it('maps missing parent/open errors and rejects invalid busy timeout values', async () => {
  let error: unknown;
  const directory = await mkdtemp(join(tmpdir(), 'context-memory-open-'));
  try {
    new SqliteMemoryStore({ path: join(directory, 'missing', 'memory.sqlite') });
  } catch (cause) {
    error = cause;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  expect(error).toMatchObject({ code: 'STORAGE_FAILED' });
  for (const busyTimeoutMs of [-1, 0.5, NaN, Infinity]) {
    error = undefined;
    try {
      new SqliteMemoryStore({ path: ':memory:', busyTimeoutMs });
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ code: 'CONFIG_INVALID' });
  }
});
