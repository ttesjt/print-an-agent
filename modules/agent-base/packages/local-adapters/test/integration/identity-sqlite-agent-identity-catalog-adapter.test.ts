import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentIdentityError, defineAgentIdentity } from '@ta-agent/base-identity';
import {
  SqliteAgentIdentityCatalogAdapter,
  type SqliteAgentIdentityTableNamesInput,
} from '../../src/index.js';
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
  it('uses exact custom table names across adapter recreation', async () => {
    const temporary = createTemporaryDatabase();
    const tableNames = { schema: 'product_identity_meta', identities: 'product_people' } as const;
    try {
      const first = new SqliteAgentIdentityCatalogAdapter({
        databasePath: temporary.databasePath,
        tableNames,
      });
      const identity = defineAgentIdentity({ id: 'custom-agent', displayName: 'Custom Agent' });
      await first.create({ identity });

      const reopened = new SqliteAgentIdentityCatalogAdapter({
        databasePath: temporary.databasePath,
        tableNames,
      });
      await expect(reopened.read(identity.id)).resolves.toMatchObject({ identity, revision: 1 });

      const database = new DatabaseSync(temporary.databasePath);
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      database.close();
      expect(tables).toEqual(['product_identity_meta', 'product_people']);
    } finally {
      temporary.dispose();
    }
  });

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
      await first.rename({
        agentId: identity.id,
        displayName: 'Renamed durable Agent',
        expectedRevision: 2,
      });

      const reopened = new SqliteAgentIdentityCatalogAdapter({
        databasePath: temporary.databasePath,
      });
      await expect(reopened.read(identity.id)).resolves.toMatchObject({
        identity: { id: identity.id, displayName: 'Renamed durable Agent' },
        status: 'disabled',
        revision: 3,
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
        .prepare('UPDATE agent_identity_schema SET version = 2 WHERE component = ?')
        .run('identity');
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

  it.each([
    { identities: 'invalid-name' },
    { identities: 'sqlite_records' },
    { identities: 'x'.repeat(129) },
    { schema: 'same_table', identities: 'SAME_TABLE' },
    { unexpected: 'records' },
  ])(
    'maps invalid table naming %# to the Identity configuration failure contract',
    (tableNames) => {
      const temporary = createTemporaryDatabase();
      try {
        try {
          new SqliteAgentIdentityCatalogAdapter({
            databasePath: temporary.databasePath,
            tableNames: tableNames as SqliteAgentIdentityTableNamesInput,
          });
          throw new Error('Expected invalid Identity table naming to fail.');
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(AgentIdentityError);
          if (!(error instanceof AgentIdentityError)) return;
          expect(error.code).toBe('AGENT_IDENTITY_CONFIGURATION_INVALID');
        }
      } finally {
        temporary.dispose();
      }
    }
  );
});
