import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defineAgentIdentity, SqliteAgentIdentityCatalogAdapter } from '../../src/index.js';
import { describe, expect, it } from 'vitest';
import { defineIdentityCatalogContract } from '../support/identity-catalog-contract.js';

function createTemporaryDatabase(): Readonly<{
  databasePath: string;
  dispose(): void;
}> {
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-identity-'));
  return Object.freeze({
    databasePath: join(directory, 'agent.sqlite'),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  });
}

function createClock(): () => number {
  let value = 1_000;
  return () => ++value;
}

defineIdentityCatalogContract('SqliteAgentIdentityCatalogAdapter', () => {
  const temporary = createTemporaryDatabase();
  return {
    catalog: new SqliteAgentIdentityCatalogAdapter({
      databasePath: temporary.databasePath,
      clock: createClock(),
    }),
    dispose: temporary.dispose,
  };
});

describe('SqliteAgentIdentityCatalogAdapter durability', () => {
  it('preserves identity lifecycle across adapter recreation', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const first = new SqliteAgentIdentityCatalogAdapter({
        databasePath: temporary.databasePath,
        clock: createClock(),
      });
      const identity = defineAgentIdentity({ id: 'durable-agent', displayName: 'Durable Agent' });
      await first.create({ identity });
      await first.transition({ agentId: identity.id, status: 'disabled', expectedRevision: 1 });

      const reopened = new SqliteAgentIdentityCatalogAdapter({
        databasePath: temporary.databasePath,
      });
      await expect(reopened.read(identity.id)).resolves.toMatchObject({
        identity,
        status: 'disabled',
        revision: 2,
      });
    } finally {
      temporary.dispose();
    }
  });

  it('rejects unsupported future schemas before reading records', () => {
    const temporary = createTemporaryDatabase();
    try {
      new SqliteAgentIdentityCatalogAdapter({ databasePath: temporary.databasePath });
      const database = new DatabaseSync(temporary.databasePath);
      database
        .prepare('UPDATE ta_agent_base_identity_schema SET version = 2 WHERE component = ?')
        .run('@ta-agent/base-identity');
      database.close();

      let received: unknown;
      try {
        new SqliteAgentIdentityCatalogAdapter({ databasePath: temporary.databasePath });
      } catch (error: unknown) {
        received = error;
      }
      expect(received).toMatchObject({ code: 'AGENT_IDENTITY_SCHEMA_UNSUPPORTED' });
    } finally {
      temporary.dispose();
    }
  });
});
