import { describe, expect, it } from 'vitest';

import {
  ModelAssetKind,
  ModelOperationKind,
  defineModelBase,
  defineModelModification,
  defineModelOutput,
  defineModelState,
  parseArtifactReference,
  parseBaseId,
  parseCapabilityId,
  parseModificationId,
  parseOutputArtifactName,
  parseOutputId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseSha256Digest,
  parseTrainerId,
  parseExporterId,
  modelOutputsEqual,
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

describe('model output', () => {
  it('records an exact source Model State and normalizes its named Artifact set', () => {
    const artifact = parseArtifactReference({
      artifactId: 'artifact:output',
      digest: `sha256:${'d'.repeat(64)}`,
      handoff: {
        runtimeSupportId: 'artifacts.fixture',
        receipt: { objectId: 'object:output' },
      },
    });
    const output = defineModelOutput({
      outputId: parseOutputId('output:fixture'),
      profileId: parseProfileId('profile:fixture'),
      artifacts: [
        { name: parseOutputArtifactName('tokenizer'), artifact },
        { name: parseOutputArtifactName('model'), artifact },
      ],
      lineage: {
        kind: ModelOperationKind.Export,
        runId: parseRunId('run:export'),
        exporterId: parseExporterId('exporter:fixture'),
        capabilityId: parseCapabilityId('capability:exporter'),
        runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
        slotEvidenceDigest: parseSha256Digest(`sha256:${'e'.repeat(64)}`),
        source: defineModelState({ baseId: 'base:source' }),
      },
    });

    expect(output).toMatchObject({
      kind: ModelAssetKind.Output,
      artifacts: [{ name: 'model' }, { name: 'tokenizer' }],
      lineage: { kind: ModelOperationKind.Export },
    });
  });

  it('rejects an empty or duplicate named Artifact set', () => {
    const artifact = parseArtifactReference({
      artifactId: 'artifact:output',
      digest: `sha256:${'d'.repeat(64)}`,
      handoff: {
        runtimeSupportId: 'artifacts.fixture',
        receipt: { objectId: 'object:output' },
      },
    });
    const input = {
      outputId: parseOutputId('output:fixture'),
      profileId: parseProfileId('profile:fixture'),
      lineage: {
        kind: ModelOperationKind.Export,
        runId: parseRunId('run:export'),
        exporterId: parseExporterId('exporter:fixture'),
        capabilityId: parseCapabilityId('capability:exporter'),
        runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
        slotEvidenceDigest: parseSha256Digest(`sha256:${'e'.repeat(64)}`),
        source: defineModelState({ baseId: 'base:source' }),
      },
    } as const;

    expect(() => defineModelOutput({ ...input, artifacts: [] })).toThrow(
      'must be a non-empty array'
    );
    expect(() =>
      defineModelOutput({
        ...input,
        artifacts: [
          { name: parseOutputArtifactName('model'), artifact },
          { name: parseOutputArtifactName('model'), artifact },
        ],
      })
    ).toThrow('must contain unique names');
  });

  it('compares semantic content independently of lineage property insertion order', () => {
    const artifact = parseArtifactReference({
      artifactId: 'artifact:output',
      digest: `sha256:${'d'.repeat(64)}`,
      handoff: {
        runtimeSupportId: 'artifacts.fixture',
        receipt: { objectId: 'object:output' },
      },
    });
    const source = defineModelState({ baseId: 'base:source' });
    const common = {
      outputId: parseOutputId('output:fixture'),
      profileId: parseProfileId('profile:fixture'),
      artifacts: [{ name: parseOutputArtifactName('model'), artifact }],
    } as const;
    const first = defineModelOutput({
      ...common,
      lineage: {
        kind: ModelOperationKind.Export,
        runId: parseRunId('run:export'),
        exporterId: parseExporterId('exporter:fixture'),
        capabilityId: parseCapabilityId('capability:exporter'),
        runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
        slotEvidenceDigest: parseSha256Digest(`sha256:${'e'.repeat(64)}`),
        source,
      },
    });
    const second = defineModelOutput({
      ...common,
      lineage: {
        source,
        slotEvidenceDigest: parseSha256Digest(`sha256:${'e'.repeat(64)}`),
        runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
        capabilityId: parseCapabilityId('capability:exporter'),
        exporterId: parseExporterId('exporter:fixture'),
        runId: parseRunId('run:export'),
        kind: ModelOperationKind.Export,
      },
    });

    expect(modelOutputsEqual(first, second)).toBe(true);
  });
});
