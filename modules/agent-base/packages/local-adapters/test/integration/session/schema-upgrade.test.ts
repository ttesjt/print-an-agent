import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, onTestFinished } from 'vitest';
import { SqliteSessionAdapter } from '../../../src/index.js';

it('upgrades the supported v4 Session layout to v5 only in initialize mode and preserves Session authority', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-session-schema-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'agent.sqlite');
  const adapter = new SqliteSessionAdapter({ databasePath });
  const reference = await adapter.resolve({ agentId: parseAgentId('schema-agent') });
  const before = await adapter.inspect(reference);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "DROP TABLE agent_sessions_memory; UPDATE agent_session_schema SET version=4 WHERE component='session'"
    );
  } finally {
    database.close();
  }
  try {
    new SqliteSessionAdapter({ databasePath, schemaMode: 'existing' });
    throw new Error('Expected existing mode to reject the v4 schema');
  } catch (error: unknown) {
    expect(error).toMatchObject({ code: 'SESSION_SCHEMA_UNSUPPORTED' });
  }
  const check = new DatabaseSync(databasePath);
  try {
    expect(
      check.prepare("SELECT version FROM agent_session_schema WHERE component='session'").get()
    ).toEqual({ version: 4 });
    expect(
      check.prepare("SELECT name FROM sqlite_master WHERE name='agent_sessions_memory'").get()
    ).toBeUndefined();
  } finally {
    check.close();
  }
  const upgraded = new SqliteSessionAdapter({ databasePath });
  expect(await upgraded.inspect(reference)).toEqual(before);
  expect(await upgraded.listPendingMemoryRecords(reference)).toEqual([]);
  const reopened = new SqliteSessionAdapter({ databasePath, schemaMode: 'existing' });
  expect(await reopened.inspect(reference)).toEqual(before);
});
