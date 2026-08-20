import { describe, expect, it, vi } from 'vitest';

import {
  ModelOperationKind,
  ModelRunResultKind,
  defineModelState,
  parseArtifactReference,
  parseBaseId,
  parseProfileId,
  parseRunId,
} from '@ta-agent/workbench-domain';

import {
  CapabilityDispatchKind,
  ExecutionStatus,
  defineJsonSchemaContract,
  defineTrainerCapability,
  type TrainingCapabilityRequest,
  type TypedTrainerCapability,
} from '../../src/index.js';

describe('Trainer Capability', () => {
  it('validates custom input and preserves the fixed materialized source envelope', async () => {
    const train: TypedTrainerCapability<TrainingInput, TrainingResultData> = vi.fn(
      (request: TrainingCapabilityRequest<TrainingInput>) =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Succeeded,
            result: {
              assetKind: ModelRunResultKind.Modification,
              artifact: {
                digest: `sha256:${'b'.repeat(64)}`,
                receipt: { outputObjectId: 'object:trained' },
              },
              data: { steps: request.input.steps },
            },
          },
        })
    );
    const capability = defineTrainerCapability({
      capabilityId: 'trainer.fixture',
      input: trainingInputContract(),
      resultData: trainingResultContract(),
      train,
    });
    const source = materializedSource();

    await expect(
      capability.train({
        operation: ModelOperationKind.Training,
        profileId: parseProfileId('profile:fixture'),
        runId: parseRunId('run:training'),
        source,
        input: { steps: 4 },
      })
    ).resolves.toMatchObject({
      terminal: {
        result: {
          assetKind: ModelRunResultKind.Modification,
          artifact: { receipt: { outputObjectId: 'object:trained' } },
          data: { steps: 4 },
        },
      },
    });
    expect(train).toHaveBeenCalledWith(
      expect.objectContaining({ source, input: { steps: 4 } }),
      undefined
    );
  });

  it('rejects invalid custom input and unknown result asset kinds', async () => {
    const untypedTrain = vi.fn(() =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            assetKind: 'checkpoint',
            artifact: {
              digest: `sha256:${'c'.repeat(64)}`,
              receipt: { outputObjectId: 'object:invalid' },
            },
          },
        },
      })
    );
    const capability = defineTrainerCapability({
      capabilityId: 'trainer.fixture',
      input: trainingInputContract(),
      train: untypedTrain as unknown as TypedTrainerCapability<TrainingInput>,
    });

    await expect(
      capability.train({
        operation: ModelOperationKind.Training,
        profileId: parseProfileId('profile:fixture'),
        runId: parseRunId('run:training'),
        source: materializedSource(),
        input: { steps: 0 },
      })
    ).rejects.toThrow('must be >= 1');
    expect(untypedTrain).not.toHaveBeenCalled();

    await expect(
      capability.train({
        operation: ModelOperationKind.Training,
        profileId: parseProfileId('profile:fixture'),
        runId: parseRunId('run:training'),
        source: materializedSource(),
        input: { steps: 1 },
      })
    ).rejects.toThrow('must equal "base" or "modification"');
  });
});

interface TrainingInput {
  readonly steps: number;
}

interface TrainingResultData {
  readonly steps: number;
}

function trainingInputContract() {
  return defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['steps'],
      properties: { steps: { type: 'integer', minimum: 1 } },
      additionalProperties: false,
    } as const,
  });
}

function trainingResultContract() {
  return defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['steps'],
      properties: { steps: { type: 'integer', minimum: 1 } },
      additionalProperties: false,
    } as const,
  });
}

function materializedSource() {
  const state = defineModelState({ baseId: 'base:source' });
  const artifact = parseArtifactReference({
    artifactId: 'artifact:source',
    digest: `sha256:${'a'.repeat(64)}`,
    handoff: {
      runtimeSupportId: 'artifacts.fixture',
      receipt: { objectId: 'object:source' },
    },
  });
  return Object.freeze({
    state,
    base: Object.freeze({
      baseId: parseBaseId('base:source'),
      artifact: Object.freeze({
        artifactId: artifact.artifactId,
        digest: artifact.digest,
        binding: { localPath: '/tmp/source' },
      }),
    }),
    modifications: Object.freeze([]),
  });
}
