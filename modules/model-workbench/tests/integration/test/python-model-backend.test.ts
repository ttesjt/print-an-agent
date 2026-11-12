import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createModelWorkbench } from '@print-an-agent/workbench-application';
import { ModelOperationKind, ModelRunStatus } from '@print-an-agent/workbench-domain';
import { OutputInvocationKind } from '@print-an-agent/workbench-extension';
import {
  PythonModelBackendDevice,
  PythonModelBackendDType,
  PythonModelBackendRuntimeSupportId,
  PythonModelBackendSlotId,
  TinyTransformerOutputFormat,
  createPythonModelBackendDefinition,
} from '@print-an-agent/workbench-python-model-backend-template-adapter';
import { describe, expect, it } from 'vitest';

const PROFILE_ID = 'profile.python-model-backend';
const ISOLATED_PROFILE_ID = 'profile.python-model-backend.isolated';
const GENERATED_BACKEND_PROJECT_NAME = 'qualified-model-backend';
const GENERATED_BACKEND_PACKAGE_NAME = 'qualified_model_backend';
const SMOKE_PYTHON_ENVIRONMENT_VARIABLE = 'TA_AGENT_MODEL_BACKEND_SMOKE_PYTHON';
const REQUIRE_SMOKE_ENVIRONMENT_VARIABLE = 'TA_AGENT_MODEL_BACKEND_REQUIRE_SMOKE';
const MODEL_CONFIGURATION = {
  contextLength: 8,
  embeddingDimension: 12,
  attentionHeads: 3,
  layers: 1,
  feedForwardMultiplier: 2,
} as const;
const pythonWorkspaceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../python'
);
const pythonExecutable = findPythonExecutable(pythonWorkspaceDirectory);
const smokeRequired = process.env[REQUIRE_SMOKE_ENVIRONMENT_VARIABLE] === '1';
const scaffoldSourceDirectory = join(pythonWorkspaceDirectory, 'packages/backend-scaffold/src');

describe('Python model backend', () => {
  it.runIf(pythonExecutable !== undefined || smokeRequired)(
    'runs all capability protocols through the public Workbench API',
    async () => {
      if (pythonExecutable === undefined) throw new Error('Python executable is unavailable.');
      const temporaryDirectory = await mkdtemp(join(tmpdir(), 'python-model-backend-'));
      try {
        const backendDirectory = join(temporaryDirectory, GENERATED_BACKEND_PROJECT_NAME);
        scaffoldBackend(pythonExecutable, backendDirectory);
        const definition = createPythonModelBackendDefinition(
          {
            pythonExecutable,
            backendModule: GENERATED_BACKEND_PACKAGE_NAME,
            backendSourceDirectory: join(backendDirectory, 'src'),
            rootDirectory: join(temporaryDirectory, 'runtime'),
            device: PythonModelBackendDevice.Cpu,
            dtype: PythonModelBackendDType.Float32,
          },
          { profiles: [{ profileId: PROFILE_ID }, { profileId: ISOLATED_PROFILE_ID }] }
        );
        const workbench = createModelWorkbench({
          ...definition,
          idSource: sequentialIdSource(),
        });

        const initialization = await workbench.initialization.start({
          profileId: PROFILE_ID,
          initializerId: PythonModelBackendSlotId.Initializer,
          input: { model: MODEL_CONFIGURATION, seed: 7 },
        });
        const initialized = await workbench.runs.wait(
          { profileId: PROFILE_ID, runId: initialization.runId },
          { pollIntervalMilliseconds: 20 }
        );
        expect(initialized).toMatchObject({
          operation: ModelOperationKind.Initialization,
          status: ModelRunStatus.Succeeded,
          result: {
            data: {
              device: 'cpu',
              dtype: 'float32',
            },
          },
        });
        if (
          initialized.operation !== ModelOperationKind.Initialization ||
          initialized.status !== ModelRunStatus.Succeeded
        ) {
          return;
        }

        const initializedBase = await workbench.models.getBase({
          profileId: PROFILE_ID,
          baseId: initialized.result.baseId,
        });
        if (initializedBase === undefined) throw new Error('Initialized Base was not persisted.');
        await expect(
          workbench.models.getBase({
            profileId: ISOLATED_PROFILE_ID,
            baseId: initialized.result.baseId,
          })
        ).resolves.toBeUndefined();
        expect(initializedBase.artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(initializedBase.artifact).toMatchObject({
          handoff: {
            runtimeSupportId: PythonModelBackendRuntimeSupportId.ArtifactHandoff,
            receipt: {
              kind: 'local-directory',
            },
          },
        });
        const source = workbench.models.compose({ baseId: initialized.result.baseId });
        const training = await workbench.training.start({
          profileId: PROFILE_ID,
          trainerId: PythonModelBackendSlotId.Trainer,
          source,
          input: { steps: 3, batchSize: 2, learningRate: 0.01, seed: 11 },
        });
        const trained = await workbench.runs.wait(
          { profileId: PROFILE_ID, runId: training.runId },
          { pollIntervalMilliseconds: 20 }
        );
        expect(trained).toMatchObject({
          operation: ModelOperationKind.Training,
          status: ModelRunStatus.Succeeded,
          result: {
            kind: 'base',
            data: {
              steps: 3,
            },
          },
        });
        if (
          trained.operation !== ModelOperationKind.Training ||
          trained.status !== ModelRunStatus.Succeeded ||
          trained.result.kind !== 'base'
        ) {
          return;
        }
        expect(readNumberProperty(initialized.result.data, 'parameterCount')).toBeGreaterThan(0);
        expect(readNumberProperty(trained.progress, 'step')).toBe(3);
        expect(readNumberProperty(trained.progress, 'totalSteps')).toBe(3);
        expect(readNumberProperty(trained.progress, 'loss')).toBeGreaterThan(0);
        expect(readNumberProperty(trained.result.data, 'initialLoss')).toBeGreaterThan(0);
        expect(readNumberProperty(trained.result.data, 'finalLoss')).toBeGreaterThan(0);

        const trainedBase = await workbench.models.getBase({
          profileId: PROFILE_ID,
          baseId: trained.result.baseId,
        });
        if (trainedBase === undefined) throw new Error('Trained Base was not persisted.');
        expect(trainedBase.artifact.digest).not.toBe(initializedBase.artifact.digest);
        const trainedState = workbench.models.compose({ baseId: trained.result.baseId });

        const exporting = await workbench.exports.start({
          profileId: PROFILE_ID,
          exporterId: PythonModelBackendSlotId.Exporter,
          source: trainedState,
          input: { format: TinyTransformerOutputFormat },
        });
        const exported = await workbench.runs.wait(
          { profileId: PROFILE_ID, runId: exporting.runId },
          { pollIntervalMilliseconds: 20 }
        );
        expect(exported).toMatchObject({
          operation: ModelOperationKind.Export,
          status: ModelRunStatus.Succeeded,
          result: {
            data: {
              format: TinyTransformerOutputFormat,
            },
          },
        });
        if (
          exported.operation !== ModelOperationKind.Export ||
          exported.status !== ModelRunStatus.Succeeded
        ) {
          return;
        }
        expect(readNumberProperty(exported.result.data, 'parameterCount')).toBeGreaterThan(0);

        const completed = await workbench.outputInvocations.invoke({
          profileId: PROFILE_ID,
          outputId: exported.result.outputId,
          input: { prompt: 'Hello 1 你好', maxNewTokens: 4, stream: false },
        });
        expect(completed.kind).toBe(OutputInvocationKind.Completed);
        if (completed.kind !== OutputInvocationKind.Completed) return;
        const completedText = readInvocationText(completed.result);
        expect(completedText).toMatch(/^.{4}$/su);

        const streaming = await workbench.outputInvocations.invoke({
          profileId: PROFILE_ID,
          outputId: exported.result.outputId,
          input: { prompt: 'Hello 1 你好', maxNewTokens: 4, stream: true },
        });
        expect(streaming.kind).toBe(OutputInvocationKind.Streaming);
        if (streaming.kind !== OutputInvocationKind.Streaming) return;
        const chunks = [];
        for await (const chunk of streaming.stream) chunks.push(chunk);
        expect(chunks).toHaveLength(4);
        expect(chunks.map(readInvocationText).join('')).toBe(completedText);
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  );
});

function scaffoldBackend(python: string, destination: string): void {
  const result = spawnSync(
    python,
    [
      '-m',
      'ta_agent_model_backend_scaffold',
      '--target',
      destination,
      '--project-name',
      GENERATED_BACKEND_PROJECT_NAME,
      '--package-name',
      GENERATED_BACKEND_PACKAGE_NAME,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: scaffoldSourceDirectory,
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `Backend scaffold failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      { cause: result.error }
    );
  }
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

function readInvocationText(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('text' in value)) {
    throw new TypeError('Invocation result must contain text.');
  }
  const { text } = value;
  if (typeof text !== 'string') throw new TypeError('Invocation result text must be a string.');
  return text;
}

function readNumberProperty(value: unknown, property: string): number {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    throw new TypeError(`Result must contain ${property}.`);
  }
  const result = value[property as keyof typeof value];
  if (typeof result !== 'number') throw new TypeError(`${property} must be a number.`);
  return result;
}

function findPythonExecutable(workspaceDirectory: string): string | undefined {
  const candidates = [
    process.env[SMOKE_PYTHON_ENVIRONMENT_VARIABLE],
    join(workspaceDirectory, '.venv/bin/python'),
    'python3.12',
    'python3.11',
    'python3',
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const result = spawnSync(
      candidate,
      [
        '-c',
        'import json, sys, torch; print(json.dumps({"executable": sys.executable, "version": list(sys.version_info[:2]), "torch": torch.__version__}))',
      ],
      { encoding: 'utf8' }
    );
    if (result.status !== 0) continue;
    const discovered = JSON.parse(result.stdout) as {
      readonly executable: unknown;
      readonly version: unknown;
    };
    if (
      typeof discovered.executable === 'string' &&
      discovered.executable.startsWith('/') &&
      Array.isArray(discovered.version) &&
      discovered.version[0] === 3 &&
      (discovered.version[1] === 11 || discovered.version[1] === 12)
    ) {
      return discovered.executable;
    }
  }
  return undefined;
}
