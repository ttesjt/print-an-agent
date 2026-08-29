import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createModelWorkbench } from '@ta-agent/workbench-application';
import {
  CapabilityDispatchKind,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  ExecutionStatus,
  JsonValueContract,
} from '@ta-agent/workbench-extension';
import { createSqliteProfilePersistenceAdapter } from '@ta-agent/workbench-persistence';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';

describe('SQLite-backed Model Workbench', () => {
  it('restores terminal Runs and assets through a new public Application instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-application-sqlite-'));
    const databasePath = join(directory, 'workbench.sqlite');
    const setup = {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'runtime.fixture',
          supports: {
            artifactHandoffId: 'artifacts.fixture',
            executionSupportId: 'execution.fixture',
          },
        },
      ],
      profiles: [
        {
          profileId: 'profile.fixture',
          initializers: [
            {
              initializerId: 'initializer.fixture',
              capabilityId: 'capability.fixture',
              runtimeBindingId: 'runtime.fixture',
            },
          ],
        },
      ],
    };
    const extensions = {
      modelCapabilities: [
        defineInitializerCapability({
          capabilityId: 'capability.fixture',
          input: JsonValueContract,
          initialize: () =>
            Promise.resolve({
              kind: CapabilityDispatchKind.Completed,
              terminal: {
                status: ExecutionStatus.Succeeded,
                result: {
                  artifact: {
                    digest: `sha256:${'a'.repeat(64)}`,
                    receipt: { location: 'fixture://durable-base' },
                  },
                },
              },
            }),
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'artifacts.fixture',
          verify: () => Promise.resolve(),
          materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
        }),
        defineExecutionSupport({
          runtimeSupportId: 'execution.fixture',
          observe: () => Promise.reject(new Error('Detached execution is not expected.')),
          cancel: () => Promise.resolve(),
        }),
      ],
    };
    const firstPersistence = createSqliteProfilePersistenceAdapter({
      resolveDatabasePath: () => databasePath,
    });

    try {
      const first = createModelWorkbench({
        setup,
        extensions,
        persistence: firstPersistence,
        idSource: {
          nextId: (kind) => `${kind}:durable`,
        },
      });
      await first.initialization.start({
        profileId: 'profile.fixture',
        initializerId: 'initializer.fixture',
        input: null,
      });
      await firstPersistence.close();

      const reopenedPersistence = createSqliteProfilePersistenceAdapter({
        resolveDatabasePath: () => databasePath,
      });
      try {
        const reopened = createModelWorkbench({
          setup,
          extensions,
          persistence: reopenedPersistence,
        });
        await expect(
          reopened.runs.get({ profileId: 'profile.fixture', runId: 'run:durable' })
        ).resolves.toMatchObject({ status: 'succeeded' });
        await expect(
          reopened.models.getBase({ profileId: 'profile.fixture', baseId: 'base:durable' })
        ).resolves.toMatchObject({
          artifact: {
            artifactId: 'artifact:durable',
            handoff: { receipt: { location: 'fixture://durable-base' } },
          },
        });
      } finally {
        await reopenedPersistence.close();
      }
    } finally {
      await firstPersistence.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
