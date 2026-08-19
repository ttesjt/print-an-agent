import { describe, expect, it } from 'vitest';

import {
  ModelOperationKind,
  ModelRunResultKind,
  ModelRunStatus,
  defineExecutionReference,
  defineModelState,
  defineStartingTrainingRun,
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
  startModelRunExecution,
  succeedTrainingRun,
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
