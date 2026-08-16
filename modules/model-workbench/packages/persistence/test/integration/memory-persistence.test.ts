import { describe, expect, it } from 'vitest';

import {
  defineModelBase,
  defineRunningInitializationRun,
  ModelOperationKind,
  parseArtifactId,
  parseBaseId,
  parseCapabilityId,
  parseInitializerId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseSha256Digest,
  succeedInitializationRun,
} from '@ta-agent/workbench-domain';

import { createMemoryPersistence, RunTransitionPersistenceError } from '../../src/index.js';

const slotEvidenceDigest = parseSha256Digest(`sha256:${'1'.repeat(64)}`);
const artifactDigest = parseSha256Digest(`sha256:${'2'.repeat(64)}`);

describe('createMemoryPersistence', () => {
  it('atomically completes an Initialization Run with its Base asset', async () => {
    const persistence = createMemoryPersistence();
    const running = runningRun();
    const baseId = parseBaseId('base:1');
    const base = defineModelBase({
      baseId,
      profileId: running.profileId,
      artifact: {
        artifactId: parseArtifactId('artifact:1'),
        digest: artifactDigest,
      },
      lineage: {
        kind: ModelOperationKind.Initialization,
        runId: running.runId,
        initializerId: running.initializerId,
        capabilityId: running.capabilityId,
        runtimeBindingId: running.runtimeBindingId,
        slotEvidenceDigest,
      },
    });
    const succeeded = succeedInitializationRun(running, baseId, { source: 'fixture' });

    await persistence.runs.create(running);
    await persistence.commits.initialization.commit({ run: succeeded, base });

    await expect(persistence.runs.find(running.runId)).resolves.toEqual(succeeded);
    await expect(persistence.parameters.findBase(baseId)).resolves.toEqual(base);
    expect(Object.isFrozen(await persistence.runs.find(running.runId))).toBe(true);
    expect(Object.isFrozen(await persistence.parameters.findBase(baseId))).toBe(true);
  });

  it('rejects a succeeded Run whose atomic commit names a different Base', async () => {
    const persistence = createMemoryPersistence();
    const running = runningRun();
    const declaredBaseId = parseBaseId('base:declared');
    const differentBase = defineModelBase({
      baseId: parseBaseId('base:different'),
      profileId: running.profileId,
      artifact: {
        artifactId: parseArtifactId('artifact:1'),
        digest: artifactDigest,
      },
      lineage: {
        kind: ModelOperationKind.Initialization,
        runId: running.runId,
        initializerId: running.initializerId,
        capabilityId: running.capabilityId,
        runtimeBindingId: running.runtimeBindingId,
        slotEvidenceDigest,
      },
    });
    await persistence.runs.create(running);

    await expect(
      persistence.commits.initialization.commit({
        run: succeedInitializationRun(running, declaredBaseId),
        base: differentBase,
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(running.runId)).resolves.toEqual(running);
  });
});

function runningRun() {
  return defineRunningInitializationRun({
    runId: parseRunId('run:1'),
    profileId: parseProfileId('research-model'),
    initializerId: parseInitializerId('import'),
    capabilityId: parseCapabilityId('initializer.import'),
    runtimeBindingId: parseRuntimeBindingId('runtime.local'),
    slotEvidenceDigest,
  });
}
