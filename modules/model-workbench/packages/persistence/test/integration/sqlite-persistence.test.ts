import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  defineStartingInitializationRun,
  parseCapabilityId,
  parseInitializerId,
  parseRunId,
  parseRuntimeBindingId,
  parseTimestamp,
} from '@print-an-agent/workbench-domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSqlitePersistence,
  createSqliteProfilePersistenceAdapter,
  PersistenceDataCorruptionError,
  PersistenceProfileScopeError,
  SqlitePersistenceError,
} from '../../src/index.js';
import {
  alternateProfileId,
  fixtureProfileId,
  fixtureSlotEvidence,
  initializationFixture,
} from '../support/persistence-fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('createSqlitePersistence', () => {
  it('rejects an empty path instead of creating an anonymous temporary database', () => {
    expect(() =>
      createSqlitePersistence({ databasePath: '', profileId: fixtureProfileId })
    ).toThrow(SqlitePersistenceError);
  });

  it('restores Runs and assets after closing and reopening the database', async () => {
    const databasePath = await temporaryDatabasePath();
    const fixture = initializationFixture('restart');

    const first = createSqlitePersistence({ databasePath, profileId: fixtureProfileId });
    await first.runs.create(fixture.starting);
    await first.commits.initialization.commit(fixture.commit);
    first.close();

    const reopened = createSqlitePersistence({ databasePath, profileId: fixtureProfileId });
    try {
      await expect(reopened.runs.find(fixture.starting.runId)).resolves.toEqual(fixture.commit.run);
      await expect(reopened.parameters.findBase(fixture.commit.base.baseId)).resolves.toEqual(
        fixture.commit.base
      );
    } finally {
      reopened.close();
    }
  });

  it('rolls back an asset write when the terminal Run update fails', async () => {
    const databasePath = await temporaryDatabasePath();
    const fixture = initializationFixture('rollback');
    const persistence = createSqlitePersistence({ databasePath, profileId: fixtureProfileId });
    await persistence.runs.create(fixture.starting);

    const administrativeConnection = new DatabaseSync(databasePath);
    administrativeConnection.exec(`
      CREATE TRIGGER reject_terminal_run
      BEFORE UPDATE ON workbench_runs
      BEGIN
        SELECT RAISE(ABORT, 'fixture terminal failure');
      END;
    `);
    administrativeConnection.close();

    await expect(persistence.commits.initialization.commit(fixture.commit)).rejects.toBeInstanceOf(
      SqlitePersistenceError
    );
    await expect(persistence.runs.find(fixture.starting.runId)).resolves.toEqual(fixture.starting);
    await expect(
      persistence.parameters.findBase(fixture.commit.base.baseId)
    ).resolves.toBeUndefined();
    persistence.close();
  });

  it('rejects records outside the configured Profile scope', async () => {
    const persistence = createSqlitePersistence({
      databasePath: await temporaryDatabasePath(),
      profileId: fixtureProfileId,
    });
    const foreignRun = defineStartingInitializationRun({
      runId: parseRunId('run:foreign'),
      profileId: alternateProfileId,
      initializerId: parseInitializerId('initializer:fixture'),
      capabilityId: parseCapabilityId('capability:initializer'),
      runtimeBindingId: parseRuntimeBindingId('binding:initializer'),
      slotEvidenceDigest: fixtureSlotEvidence,
      input: { fixture: 'foreign' },
      createdAt: CREATED_AT,
    });
    try {
      await expect(persistence.runs.create(foreignRun)).rejects.toBeInstanceOf(
        PersistenceProfileScopeError
      );
    } finally {
      persistence.close();
    }
  });

  it('rejects malformed durable records at the read boundary', async () => {
    const databasePath = await temporaryDatabasePath();
    const fixture = initializationFixture('corrupt');
    const first = createSqlitePersistence({ databasePath, profileId: fixtureProfileId });
    await first.runs.create(fixture.starting);
    first.close();

    const administrativeConnection = new DatabaseSync(databasePath);
    administrativeConnection
      .prepare('UPDATE workbench_runs SET payload_json = ? WHERE profile_id = ? AND run_id = ?')
      .run('{}', fixtureProfileId, fixture.starting.runId);
    administrativeConnection.close();

    const reopened = createSqlitePersistence({ databasePath, profileId: fixtureProfileId });
    try {
      await expect(reopened.runs.find(fixture.starting.runId)).rejects.toBeInstanceOf(
        PersistenceDataCorruptionError
      );
    } finally {
      reopened.close();
    }
  });

  it('owns only namespaced Workbench tables in a shared SQLite database', async () => {
    const databasePath = await temporaryDatabasePath();
    const administrativeConnection = new DatabaseSync(databasePath);
    administrativeConnection.exec('PRAGMA user_version = 73');
    administrativeConnection.close();

    const persistence = createSqlitePersistence({ databasePath, profileId: fixtureProfileId });
    persistence.close();

    const inspectionConnection = new DatabaseSync(databasePath);
    const tables = inspectionConnection
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'workbench_%'
         ORDER BY name`
      )
      .all()
      .map((row) => (row as Readonly<Record<string, unknown>>).name);
    const userVersion = inspectionConnection.prepare('PRAGMA user_version').get() as Readonly<
      Record<string, unknown>
    >;
    inspectionConnection.close();

    expect(tables).toEqual([
      'workbench_bases',
      'workbench_modifications',
      'workbench_outputs',
      'workbench_runs',
      'workbench_schema_migrations',
    ]);
    expect(userVersion.user_version).toBe(73);
  });
});

describe('createSqliteProfilePersistenceAdapter', () => {
  it('rejects an acquisition that is still resolving when close begins', async () => {
    const databasePath = await temporaryDatabasePath();
    let resolvePath: ((databasePath: string) => void) | undefined;
    const path = new Promise<string>((resolve) => {
      resolvePath = resolve;
    });
    const adapter = createSqliteProfilePersistenceAdapter({
      resolveDatabasePath: () => path,
    });
    const acquisition = adapter.forProfile({ profileId: fixtureProfileId });
    const closing = adapter.close();

    resolvePath?.(databasePath);

    await expect(acquisition).rejects.toMatchObject({
      code: 'SQLITE_PERSISTENCE_FAILED',
      message: 'The SQLite persistence adapter is closed.',
    });
    await closing;
  });

  it('routes Profiles through user-owned configuration and isolates equal record IDs', async () => {
    const directory = await temporaryDirectory();
    const databasePath = join(directory, 'shared.sqlite');
    const adapter = createSqliteProfilePersistenceAdapter({
      resolveDatabasePath: ({ configuration }) => {
        const configuredPath = configuration?.databasePath;
        if (typeof configuredPath !== 'string') throw new Error('databasePath is required');
        return configuredPath;
      },
    });
    const first = await adapter.forProfile({
      profileId: fixtureProfileId,
      configuration: { databasePath },
    });
    const second = await adapter.forProfile({
      profileId: alternateProfileId,
      configuration: { databasePath },
    });
    const sharedRunId = parseRunId('run:shared-identity');
    const firstRun = defineStartingInitializationRun({
      runId: sharedRunId,
      profileId: fixtureProfileId,
      initializerId: parseInitializerId('initializer:first'),
      capabilityId: parseCapabilityId('capability:first'),
      runtimeBindingId: parseRuntimeBindingId('binding:first'),
      slotEvidenceDigest: fixtureSlotEvidence,
      input: { fixture: 'first' },
      createdAt: CREATED_AT,
    });
    const secondRun = defineStartingInitializationRun({
      runId: sharedRunId,
      profileId: alternateProfileId,
      initializerId: parseInitializerId('initializer:second'),
      capabilityId: parseCapabilityId('capability:second'),
      runtimeBindingId: parseRuntimeBindingId('binding:second'),
      slotEvidenceDigest: fixtureSlotEvidence,
      input: { fixture: 'second' },
      createdAt: CREATED_AT,
    });

    await first.runs.create(firstRun);
    await second.runs.create(secondRun);
    await expect(first.runs.find(sharedRunId)).resolves.toEqual(firstRun);
    await expect(second.runs.find(sharedRunId)).resolves.toEqual(secondRun);
    await adapter.close();
  });
});

async function temporaryDatabasePath(): Promise<string> {
  return join(await temporaryDirectory(), 'workbench.sqlite');
}

const CREATED_AT = parseTimestamp('2026-08-24T10:00:00.000Z');

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-sqlite-'));
  temporaryDirectories.push(directory);
  return directory;
}
