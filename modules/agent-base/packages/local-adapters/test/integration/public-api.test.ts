import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as adapters from '../../src/index.js';
it('preserves the deliberate local adapter runtime API', () => {
  expect(Object.keys(adapters).sort()).toEqual([
    'DEFAULT_SQLITE_AGENT_CONFIG_TABLE_NAMES',
    'DEFAULT_SQLITE_AGENT_IDENTITY_TABLE_NAMES',
    'DEFAULT_SQLITE_REQUEST_JOURNAL_TABLE_NAMES',
    'DEFAULT_SQLITE_SESSION_TABLE_NAMES',
    'MemoryAgentConfigAdapter',
    'MemoryAgentIdentityCatalogAdapter',
    'MemoryAgentTraceAdapter',
    'MemoryOutputSink',
    'MemoryRequestJournalAdapter',
    'MemorySessionAdapter',
    'SqliteAgentConfigAdapter',
    'SqliteAgentIdentityCatalogAdapter',
    'SqliteRequestJournalAdapter',
    'SqliteSessionAdapter',
    'createMemorySessionPersistence',
    'createSqliteSessionPersistence',
    'resolveSqliteAgentConfigTableNames',
    'resolveSqliteAgentIdentityTableNames',
    'resolveSqliteRequestJournalTableNames',
    'resolveSqliteSessionTableNames',
  ]);
});

it('omits private coordination hooks from compiled public adapter declarations', () => {
  const root = fileURLToPath(new URL('../../dist/', import.meta.url));
  function declarations(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = join(directory, entry.name);
      return entry.isDirectory()
        ? declarations(file)
        : /memory-(session|request-journal)-adapter\.d\.ts$/u.test(entry.name)
          ? [file]
          : [];
    });
  }
  const files = declarations(root);
  expect(files).toHaveLength(2);
  for (const file of files)
    expect(readFileSync(file, 'utf8')).not.toMatch(/memory(?:Session|Journal)Coordination/u);
});
