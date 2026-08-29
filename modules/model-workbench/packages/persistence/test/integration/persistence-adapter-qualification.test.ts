import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ProfilePersistence } from '../../src/index.js';
import { createMemoryPersistence, createSqlitePersistence } from '../../src/index.js';
import {
  exportFixture,
  fixtureProfileId,
  initializationFixture,
  trainingModificationFixture,
} from '../support/persistence-fixtures.js';

interface PersistenceHarness {
  readonly persistence: ProfilePersistence;
  close(): Promise<void>;
}

const harnesses: readonly {
  readonly name: string;
  readonly create: () => Promise<PersistenceHarness>;
}[] = [
  {
    name: 'Memory',
    create: () =>
      Promise.resolve({
        persistence: createMemoryPersistence({ profileId: fixtureProfileId }),
        close: () => Promise.resolve(),
      }),
  },
  {
    name: 'SQLite',
    create: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'workbench-persistence-'));
      const persistence = createSqlitePersistence({
        databasePath: join(directory, 'workbench.sqlite'),
        profileId: fixtureProfileId,
      });
      return {
        persistence,
        close: async () => {
          persistence.close();
          await rm(directory, { recursive: true, force: true });
        },
      };
    },
  },
];

describe.each(harnesses)('$name persistence qualification', ({ create }) => {
  it('persists the complete parameter and Output lifecycle with idempotent commits', async () => {
    const harness = await create();
    try {
      const initialization = initializationFixture('qualification');
      await harness.persistence.runs.create(initialization.starting);
      await harness.persistence.commits.initialization.commit(initialization.commit);
      await harness.persistence.commits.initialization.commit(initialization.commit);

      const training = trainingModificationFixture('qualification');
      await harness.persistence.runs.create(training.starting);
      await harness.persistence.commits.training.commit(training.commit);
      await harness.persistence.commits.training.commit(training.commit);

      const exported = exportFixture('qualification');
      await harness.persistence.runs.create(exported.starting);
      await harness.persistence.commits.export.commit(exported.commit);
      await harness.persistence.commits.export.commit(exported.commit);

      await expect(harness.persistence.runs.find(initialization.starting.runId)).resolves.toEqual(
        initialization.commit.run
      );
      await expect(
        harness.persistence.parameters.findBase(initialization.commit.base.baseId)
      ).resolves.toEqual(initialization.commit.base);
      await expect(
        harness.persistence.parameters.findModification(training.commit.modification.modificationId)
      ).resolves.toEqual(training.commit.modification);
      await expect(
        harness.persistence.outputs.findOutput(exported.commit.output.outputId)
      ).resolves.toEqual(exported.commit.output);

      const firstRuns = await harness.persistence.runs.list({ limit: 2 });
      expect(firstRuns.records.map((run) => run.runId)).toEqual([
        'run:export:qualification',
        'run:initialization:qualification',
      ]);
      expect(firstRuns.hasMore).toBe(true);
      const runCursor = firstRuns.records[1]?.runId;
      if (runCursor === undefined)
        throw new Error('Expected the first Run page to contain two records.');
      await expect(
        harness.persistence.runs.list({
          after: runCursor,
          limit: 2,
        })
      ).resolves.toMatchObject({
        records: [{ runId: 'run:training:qualification' }],
        hasMore: false,
      });
      await expect(harness.persistence.parameters.listBases({ limit: 10 })).resolves.toMatchObject({
        records: [{ baseId: initialization.commit.base.baseId }],
        hasMore: false,
      });
      await expect(
        harness.persistence.parameters.listModifications({ limit: 10 })
      ).resolves.toMatchObject({
        records: [{ modificationId: training.commit.modification.modificationId }],
        hasMore: false,
      });
      await expect(harness.persistence.outputs.listOutputs({ limit: 10 })).resolves.toMatchObject({
        records: [{ outputId: exported.commit.output.outputId }],
        hasMore: false,
      });
    } finally {
      await harness.close();
    }
  });
});
