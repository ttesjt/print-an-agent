import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { ModelOperationKind, ModelRunStatus } from '@ta-agent/workbench-domain';
import { OutputInvocationKind } from '@ta-agent/workbench-extension';
import { describe, expect, it } from 'vitest';

import { createPublicLocalWorkbench } from './fixtures/public-local-workbench.js';

const pythonExecutable = findPythonExecutable();
const backendPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'local-model-backend.py'
);
const ProfileId = 'profile.local-product';

describe('durable local Model Workbench product', () => {
  it.runIf(pythonExecutable !== undefined)(
    'runs initialization, training, export, streaming invocation, discovery, and restart recovery',
    async () => {
      if (pythonExecutable === undefined) throw new Error('Python executable is unavailable.');
      const rootDirectory = await mkdtemp(join(tmpdir(), 'workbench-local-product-'));
      const databasePath = join(rootDirectory, 'workbench.sqlite');
      await mkdir(join(rootDirectory, ProfileId, 'artifacts'), { recursive: true });
      const idSource = sequentialIdSource();
      let application = createPublicLocalWorkbench({
        rootDirectory,
        databasePath,
        backendExecutable: pythonExecutable,
        backendPath,
        idSource,
      });
      try {
        const initialized = await application.workbench.initialization.start({
          profileId: ProfileId,
          initializerId: 'initialize',
          input: operationInput(rootDirectory, 'base', { weight: 1 }),
        });
        const initializationRun = await application.workbench.runs.wait(
          { profileId: ProfileId, runId: initialized.runId },
          { pollIntervalMilliseconds: 20 }
        );
        expect(initializationRun).toMatchObject({
          operation: ModelOperationKind.Initialization,
          status: ModelRunStatus.Succeeded,
        });
        if (
          initializationRun.status !== ModelRunStatus.Succeeded ||
          initializationRun.operation !== ModelOperationKind.Initialization
        ) {
          return;
        }
        const baseId = initializationRun.result.baseId;

        const trainingSource = application.workbench.models.compose({ baseId });
        const trained = await application.workbench.training.start({
          profileId: ProfileId,
          trainerId: 'train',
          source: trainingSource,
          input: {
            ...operationInput(rootDirectory, 'modification', { delta: 2 }),
            assetKind: 'modification',
            steps: 3,
            delaySeconds: 0.1,
          },
        });
        await application.persistence.close();

        application = createPublicLocalWorkbench({
          rootDirectory,
          databasePath,
          backendExecutable: pythonExecutable,
          backendPath,
          idSource,
        });
        const trainingRun = await application.workbench.runs.wait(
          { profileId: ProfileId, runId: trained.runId },
          { pollIntervalMilliseconds: 20 }
        );
        expect(trainingRun).toMatchObject({
          operation: ModelOperationKind.Training,
          status: ModelRunStatus.Succeeded,
          result: { kind: 'modification', data: { steps: 3 } },
        });
        if (
          trainingRun.status !== ModelRunStatus.Succeeded ||
          trainingRun.operation !== ModelOperationKind.Training ||
          trainingRun.result.kind !== 'modification'
        ) {
          return;
        }
        const modificationId = trainingRun.result.modificationId;
        const state = application.workbench.models.compose({
          baseId,
          modificationIds: [modificationId],
        });

        const exported = await application.workbench.exports.start({
          profileId: ProfileId,
          exporterId: 'export',
          source: state,
          input: operationInput(rootDirectory, 'output', { format: 'tiny-json' }),
        });
        const exportRun = await application.workbench.runs.wait(
          { profileId: ProfileId, runId: exported.runId },
          { pollIntervalMilliseconds: 20 }
        );
        expect(exportRun).toMatchObject({
          operation: ModelOperationKind.Export,
          status: ModelRunStatus.Succeeded,
        });
        if (
          exportRun.status !== ModelRunStatus.Succeeded ||
          exportRun.operation !== ModelOperationKind.Export
        ) {
          return;
        }
        const outputId = exportRun.result.outputId;

        const invocation = await application.workbench.outputInvocations.invoke({
          profileId: ProfileId,
          outputId,
          outputInvokerId: 'invoke',
          input: { prompt: 'hello', stream: true },
        });
        expect(invocation.kind).toBe(OutputInvocationKind.Streaming);
        if (invocation.kind !== OutputInvocationKind.Streaming) return;
        const chunks = [];
        for await (const chunk of invocation.stream) chunks.push(chunk);
        expect(chunks).toEqual([{ text: 'hello' }, { model: { format: 'tiny-json' } }]);

        await application.persistence.close();
        application = createPublicLocalWorkbench({
          rootDirectory,
          databasePath,
          backendExecutable: pythonExecutable,
          backendPath,
        });
        await expect(
          application.workbench.runs.wait({ profileId: ProfileId, runId: trained.runId })
        ).resolves.toEqual(trainingRun);
        await expect(
          application.workbench.runs.list({ profileId: ProfileId, limit: 10 })
        ).resolves.toMatchObject({ records: [{}, {}, {}] });
        const firstRunPage = await application.workbench.runs.list({
          profileId: ProfileId,
          limit: 1,
        });
        expect(firstRunPage.records).toHaveLength(1);
        expect(firstRunPage.nextCursor).toBeDefined();
        if (firstRunPage.nextCursor === undefined) return;
        await expect(
          application.workbench.runs.list({
            profileId: ProfileId,
            cursor: firstRunPage.nextCursor,
            limit: 10,
          })
        ).resolves.toMatchObject({ records: [{}, {}] });
        await expect(
          application.workbench.runs.list({
            profileId: ProfileId,
            operation: ModelOperationKind.Training,
            status: ModelRunStatus.Succeeded,
          })
        ).resolves.toMatchObject({ records: [{ runId: trained.runId }] });
        await expect(
          application.workbench.models.listBases({ profileId: ProfileId })
        ).resolves.toMatchObject({ records: [{ baseId }] });
        await expect(
          application.workbench.models.listModifications({ profileId: ProfileId })
        ).resolves.toMatchObject({
          records: [{ modificationId, lineage: { source: trainingSource } }],
        });
        await expect(
          application.workbench.outputs.list({ profileId: ProfileId })
        ).resolves.toMatchObject({ records: [{ outputId, lineage: { source: state } }] });
      } finally {
        await application.persistence.close();
        await rm(rootDirectory, { recursive: true, force: true });
      }
    }
  );
});

function operationInput(rootDirectory: string, relativePath: string, content: unknown) {
  return {
    artifact: {
      directory: join(rootDirectory, ProfileId, 'artifacts', relativePath),
      relativePath,
      content,
    },
  };
}

function sequentialIdSource() {
  const counts = { run: 0, base: 0, modification: 0, output: 0, artifact: 0 };
  return {
    nextId: (kind: keyof typeof counts) => {
      counts[kind] += 1;
      return `${kind}:${String(counts[kind])}`;
    },
  };
}

function findPythonExecutable(): string | undefined {
  const result = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const executable = result.stdout.trim();
  return executable.startsWith('/') ? executable : undefined;
}
