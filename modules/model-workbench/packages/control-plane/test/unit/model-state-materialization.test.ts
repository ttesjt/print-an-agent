import { describe, expect, it, vi } from 'vitest';

import {
  ModelOperationKind,
  defineModelBase,
  defineModelModification,
  defineModelState,
  parseArtifactReference,
  parseBaseId,
  parseCapabilityId,
  parseInitializerId,
  parseModificationId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseSha256Digest,
  parseTrainerId,
  type ModelBase,
  type ModelModification,
} from '@ta-agent/workbench-domain';
import { defineArtifactHandoffSupport } from '@ta-agent/workbench-extension';
import type { ParameterRepository } from '@ta-agent/workbench-persistence';

import {
  ArtifactHandoffSupportNotFoundError,
  ModelStateAssetNotFoundError,
  ModelStateAssetProfileMismatchError,
} from '../../src/model-states/errors.js';
import { createModelStateMaterializer } from '../../src/model-states/materialize-model-state.js';

const runId = parseRunId('run:training');
const slotEvidenceDigest = parseSha256Digest(`sha256:${'e'.repeat(64)}`);

describe('materialize Model State', () => {
  it('verifies and materializes every parameter Artifact through its owning Support', async () => {
    const local = artifactSupport('artifacts.local', '/materialized/base');
    const remote = artifactSupport('artifacts.remote', '/materialized/modification');
    const base = modelBase();
    const modifications = [
      modelModification('modification:one'),
      modelModification('modification:two'),
    ];
    const state = defineModelState({
      baseId: base.baseId,
      modificationIds: modifications.map(({ modificationId }) => modificationId),
    });
    const prepare = createModelStateMaterializer({
      artifactHandoffSupports: [local.support, remote.support],
      parameters: parameterRepository(base, modifications),
    });

    await expect(
      prepare({
        runId,
        profileId: parseProfileId('profile:fixture'),
        operation: ModelOperationKind.Training,
        state,
      })
    ).resolves.toMatchObject({
      state,
      base: {
        baseId: 'base:source',
        artifact: { binding: { path: '/materialized/base' } },
      },
      modifications: [
        {
          modificationId: 'modification:one',
          artifact: { binding: { path: '/materialized/modification/one' } },
        },
        {
          modificationId: 'modification:two',
          artifact: { binding: { path: '/materialized/modification/two' } },
        },
      ],
    });
    expect(local.verify).toHaveBeenCalledOnce();
    expect(remote.verify).toHaveBeenCalledTimes(2);
  });

  it('fails before invocation when a parameter asset or owning Support is unavailable', async () => {
    const base = modelBase();
    const missingModification = defineModelState({
      baseId: base.baseId,
      modificationIds: ['modification:missing'],
    });
    const prepareMissingAsset = createModelStateMaterializer({
      artifactHandoffSupports: [],
      parameters: parameterRepository(base, []),
    });
    await expect(
      prepareMissingAsset({
        runId,
        profileId: parseProfileId('profile:fixture'),
        operation: ModelOperationKind.Training,
        state: missingModification,
      })
    ).rejects.toBeInstanceOf(ModelStateAssetNotFoundError);

    const prepareMissingSupport = createModelStateMaterializer({
      artifactHandoffSupports: [],
      parameters: parameterRepository(base, []),
    });
    await expect(
      prepareMissingSupport({
        runId,
        profileId: parseProfileId('profile:fixture'),
        operation: ModelOperationKind.Training,
        state: defineModelState({ baseId: base.baseId }),
      })
    ).rejects.toBeInstanceOf(ArtifactHandoffSupportNotFoundError);
  });

  it('rejects a parameter asset owned by another Profile', async () => {
    const base = modelBase('profile:other');
    const prepare = createModelStateMaterializer({
      artifactHandoffSupports: [],
      parameters: parameterRepository(base, []),
    });

    await expect(
      prepare({
        runId,
        profileId: parseProfileId('profile:fixture'),
        operation: ModelOperationKind.Training,
        state: defineModelState({ baseId: base.baseId }),
      })
    ).rejects.toBeInstanceOf(ModelStateAssetProfileMismatchError);
  });
});

function modelBase(profileId = 'profile:fixture'): ModelBase {
  return defineModelBase({
    baseId: parseBaseId('base:source'),
    profileId: parseProfileId(profileId),
    artifact: artifactReference('artifact:base', 'artifacts.local', 'base'),
    lineage: {
      kind: ModelOperationKind.Initialization,
      runId: parseRunId('run:initialization'),
      initializerId: parseInitializerId('initializer:fixture'),
      capabilityId: parseCapabilityId('capability:initializer'),
      runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
      slotEvidenceDigest,
    },
  });
}

function modelModification(modificationId: string): ModelModification {
  const parsedModificationId = parseModificationId(modificationId);
  return defineModelModification({
    modificationId: parsedModificationId,
    profileId: parseProfileId('profile:fixture'),
    artifact: artifactReference(
      `artifact:${modificationId}`,
      'artifacts.remote',
      modificationId.split(':').at(-1) ?? modificationId
    ),
    lineage: {
      kind: ModelOperationKind.Training,
      runId: parseRunId(`run:${modificationId}`),
      trainerId: parseTrainerId('trainer:fixture'),
      capabilityId: parseCapabilityId('capability:trainer'),
      runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
      slotEvidenceDigest,
      source: defineModelState({ baseId: 'base:source' }),
    },
  });
}

function artifactReference(artifactId: string, runtimeSupportId: string, objectId: string) {
  return parseArtifactReference({
    artifactId,
    digest: `sha256:${'a'.repeat(64)}`,
    handoff: { runtimeSupportId, receipt: { objectId } },
  });
}

function artifactSupport(runtimeSupportId: string, basePath: string) {
  const verify = vi.fn(() => Promise.resolve());
  const support = defineArtifactHandoffSupport({
    runtimeSupportId,
    verify,
    materialize: ({ artifact }) => {
      const suffix = artifact.artifactId.split(':').at(-1);
      return Promise.resolve({
        path: suffix === 'base' ? basePath : `${basePath}/${String(suffix)}`,
      });
    },
  });
  return { support, verify };
}

function parameterRepository(
  base: ModelBase,
  modifications: readonly ModelModification[]
): ParameterRepository {
  const modificationById = new Map(
    modifications.map((modification) => [modification.modificationId, modification])
  );
  return {
    findBase: (baseId) => Promise.resolve(baseId === base.baseId ? base : undefined),
    findModification: (modificationId) => Promise.resolve(modificationById.get(modificationId)),
  };
}
