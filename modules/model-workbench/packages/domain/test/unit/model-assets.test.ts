import { describe, expect, it } from 'vitest';

import {
  ModelAssetKind,
  ModelOperationKind,
  defineModelBase,
  defineModelModification,
  defineModelState,
  parseArtifactReference,
  parseBaseId,
  parseCapabilityId,
  parseModificationId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseSha256Digest,
  parseTrainerId,
} from '../../src/index.js';

describe('trained model assets', () => {
  it('records the exact source Model State in Base and Modification lineage', () => {
    const source = defineModelState({
      baseId: 'base:source',
      modificationIds: ['modification:source'],
    });
    const lineage = {
      kind: ModelOperationKind.Training,
      runId: parseRunId('run:training'),
      trainerId: parseTrainerId('trainer:fixture'),
      capabilityId: parseCapabilityId('capability:trainer'),
      runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
      slotEvidenceDigest: parseSha256Digest(`sha256:${'b'.repeat(64)}`),
      source,
    } as const;
    const artifact = parseArtifactReference({
      artifactId: 'artifact:trained',
      digest: `sha256:${'c'.repeat(64)}`,
      handoff: {
        runtimeSupportId: 'artifacts.fixture',
        receipt: { objectId: 'object:trained' },
      },
    });
    const base = defineModelBase({
      baseId: parseBaseId('base:trained'),
      profileId: parseProfileId('profile:fixture'),
      artifact,
      lineage,
    });
    const modification = defineModelModification({
      modificationId: parseModificationId('modification:trained'),
      profileId: parseProfileId('profile:fixture'),
      artifact,
      lineage,
    });

    expect(base).toMatchObject({
      kind: ModelAssetKind.Base,
      lineage: { kind: ModelOperationKind.Training, source },
    });
    expect(modification).toMatchObject({
      kind: ModelAssetKind.Modification,
      lineage: { kind: ModelOperationKind.Training, source },
    });
  });
});
