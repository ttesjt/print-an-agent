import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createModelWorkbench } from '@ta-agent/workbench-application';
import { ModelOperationKind } from '@ta-agent/workbench-domain';
import { JsonValueContract, defineInitializerCapability } from '@ta-agent/workbench-extension';
import {
  createLocalArtifactHandoffSupport,
  createLocalCommandBridge,
  createLocalExecutionSupport,
  defineLocalDirectoryArtifactReceipt,
  deriveLocalDirectoryArtifactDigest,
} from '@ta-agent/workbench-local-runtime';
import { createSqliteProfilePersistenceAdapter } from '@ta-agent/workbench-persistence';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';
import { describe, expect, it } from 'vitest';

const pythonExecutable = findPythonExecutable();
const backendPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'local-initializer.py'
);

describe('local command supervisor', () => {
  it.runIf(pythonExecutable !== undefined)(
    'resumes a detached Python initialization through a new Workbench process boundary',
    async () => {
      if (pythonExecutable === undefined) throw new Error('Python executable is unavailable.');
      const rootDirectory = await mkdtemp(join(tmpdir(), 'workbench-local-supervisor-'));
      const profileId = 'profile.local-python';
      const artifactDirectory = join(rootDirectory, profileId, 'artifacts', 'initialized');
      const databasePath = join(rootDirectory, 'workbench.sqlite');
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(join(artifactDirectory, 'parameters.json'), '{"weight":1}\n', 'utf8');
      const digest = await deriveLocalDirectoryArtifactDigest(artifactDirectory);
      const bridge = createLocalCommandBridge({
        rootDirectory,
        command: { executable: pythonExecutable, arguments: [backendPath] },
      });
      const setup = {
        runtimeBindings: [
          {
            kind: RuntimeBindingKind.Binding,
            runtimeBindingId: 'runtime.local',
            supports: {
              artifactHandoffId: 'artifacts.local',
              executionSupportId: 'execution.local',
            },
          },
        ],
        profiles: [
          {
            profileId,
            initializers: [
              {
                initializerId: 'python',
                capabilityId: 'initializer.python',
                runtimeBindingId: 'runtime.local',
              },
            ],
          },
        ],
      };
      const extensions = {
        modelCapabilities: [
          defineInitializerCapability({
            capabilityId: 'initializer.python',
            input: JsonValueContract,
            initialize: (request, options) => bridge.dispatch(request, options),
          }),
        ],
        runtimeSupports: [
          createLocalArtifactHandoffSupport({
            runtimeSupportId: 'artifacts.local',
            rootDirectory,
          }),
          createLocalExecutionSupport({
            runtimeSupportId: 'execution.local',
            rootDirectory,
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
          idSource: { nextId: (kind) => `${kind}:local-python` },
        });
        const started = await first.initialization.start({
          profileId,
          initializerId: 'python',
          input: {
            delaySeconds: 0.1,
            result: {
              artifact: {
                digest,
                receipt: defineLocalDirectoryArtifactReceipt({ relativePath: 'initialized' }),
              },
              data: { backend: 'python' },
            },
          },
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
          const terminal = await reopened.runs.wait(
            { profileId, runId: started.runId },
            { pollIntervalMilliseconds: 20 }
          );
          expect(terminal).toMatchObject({
            status: 'succeeded',
            result: { data: { backend: 'python' } },
          });
          if (
            terminal.status !== 'succeeded' ||
            terminal.operation !== ModelOperationKind.Initialization
          ) {
            throw new Error('Expected initialization to produce a Base.');
          }
          await expect(
            reopened.models.getBase({ profileId, baseId: terminal.result.baseId })
          ).resolves.toMatchObject({
            artifact: {
              digest,
              handoff: {
                runtimeSupportId: 'artifacts.local',
                receipt: { kind: 'local-directory', relativePath: 'initialized' },
              },
            },
          });
        } finally {
          await reopenedPersistence.close();
        }
      } finally {
        await firstPersistence.close();
        await rm(rootDirectory, { recursive: true, force: true });
      }
    }
  );
});

function findPythonExecutable(): string | undefined {
  const result = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const executable = result.stdout.trim();
  return executable.startsWith('/') ? executable : undefined;
}
