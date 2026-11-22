import { expect, it } from 'vitest';

import * as sqlite from '@print-an-agent/context-memory-sqlite';

it('preserves the deliberate SQLite adapter API and coordinated defaults', () => {
  expect(Object.keys(sqlite).sort()).toEqual([
    'DEFAULT_MAX_MEMORY_DELTA_CHAIN',
    'DEFAULT_SQLITE_BUSY_TIMEOUT_MS',
    'SqliteMemoryStore',
  ]);
  expect(sqlite.DEFAULT_SQLITE_BUSY_TIMEOUT_MS).toBe(5000);
  expect(sqlite.DEFAULT_MAX_MEMORY_DELTA_CHAIN).toBe(32);
});
