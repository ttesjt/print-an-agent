import { describe, expect, it } from 'vitest';

import {
  ModelOperationKind,
  ModelRunResultKind,
  ModelRunStatus,
  defineExecutionReference,
  defineModelState,
  defineStartingTrainingRun,
  defineStartingExportRun,
  modelRunDefinitionsEqual,
  parseBaseId,
  parseCapabilityId,
  parseModificationId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
  parseSha256Digest,
  parseTrainerId,
  parseExporterId,
  parseOutputId,
  startModelRunExecution,
  succeedTrainingRun,
  succeedExportRun,
  updateModelRunProgress,
} from '../../src/index.js';

describe('Training Model Run', () => {
  it('freezes an exact source Model State and preserves it through execution', () => {
    const starting = trainingRun();
    const running = startModelRunExecution(
      starting,
      defineExecutionReference({
        runtimeSupportId: parseRuntimeSupportId('execution.fixture'),
        receipt: { jobId: 'job:1' },
      })
    );
    const progressed = updateModelRunProgress(running, { step: 4, loss: 0.25 });
    const succeeded = succeedTrainingRun(
      progressed,
      { kind: ModelRunResultKind.Modification, modificationId: parseModificationId('mod:new') },
      { epochs: 1 }
    );

    expect(starting).toMatchObject({
      operation: ModelOperationKind.Training,
      status: ModelRunStatus.Starting,
      trainerId: 'trainer:fixture',
      source: {
        baseId: 'base:source',
        modificationIds: ['mod:one', 'mod:two'],
      },
    });
    expect(succeeded).toMatchObject({
      status: ModelRunStatus.Succeeded,
      execution: { receipt: { jobId: 'job:1' } },
      progress: { step: 4, loss: 0.25 },
      result: {
        kind: ModelRunResultKind.Modification,
        modificationId: 'mod:new',
        data: { epochs: 1 },
      },
    });
  });

  it('supports either a new Base or an additive Modification result', () => {
    const baseResult = succeedTrainingRun(trainingRun(), {
      kind: ModelRunResultKind.Base,
      baseId: parseBaseId('base:trained'),
    });
    const modificationResult = succeedTrainingRun(trainingRun(), {
      kind: ModelRunResultKind.Modification,
      modificationId: parseModificationId('mod:trained'),
    });

    expect(baseResult.result).toEqual({ kind: ModelRunResultKind.Base, baseId: 'base:trained' });
    expect(modificationResult.result).toEqual({
      kind: ModelRunResultKind.Modification,
      modificationId: 'mod:trained',
    });
  });

  it('treats Trainer and ordered source State as frozen Run selection', () => {
    const original = trainingRun();
    const same = trainingRun();
    const reordered = trainingRun(
      defineModelState({
        baseId: 'base:source',
        modificationIds: ['mod:two', 'mod:one'],
      })
    );

    expect(modelRunDefinitionsEqual(original, same)).toBe(true);
    expect(modelRunDefinitionsEqual(original, reordered)).toBe(false);
  });
});

describe('Export Model Run', () => {
  it('freezes its source State and records the produced Output identity', () => {
    const source = defineModelState({
      baseId: 'base:source',
      modificationIds: ['mod:one'],
    });
    const starting = defineStartingExportRun({
      runId: parseRunId('run:export'),
      profileId: parseProfileId('profile:fixture'),
      exporterId: parseExporterId('exporter:fixture'),
      capabilityId: parseCapabilityId('capability:exporter'),
      runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
      slotEvidenceDigest: parseSha256Digest(`sha256:${'b'.repeat(64)}`),
      source,
    });
    const succeeded = succeedExportRun(starting, parseOutputId('output:fixture'), {
      format: 'gguf',
    });

    expect(succeeded).toMatchObject({
      operation: ModelOperationKind.Export,
      status: ModelRunStatus.Succeeded,
      exporterId: 'exporter:fixture',
      source,
      result: {
        kind: ModelRunResultKind.Output,
        outputId: 'output:fixture',
        data: { format: 'gguf' },
      },
    });
  });
});

function trainingRun(
  source = defineModelState({
    baseId: 'base:source',
    modificationIds: ['mod:one', 'mod:two'],
  })
) {
  return defineStartingTrainingRun({
    runId: parseRunId('run:training'),
    profileId: parseProfileId('profile:fixture'),
    trainerId: parseTrainerId('trainer:fixture'),
    capabilityId: parseCapabilityId('capability:trainer'),
    runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
    slotEvidenceDigest: parseSha256Digest(`sha256:${'a'.repeat(64)}`),
    source,
  });
}
