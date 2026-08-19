import { describe, expect, it, vi } from 'vitest';

import { InvalidWorkbenchValueError, parseArtifactReference } from '@ta-agent/workbench-domain';

import { RuntimeSupportKind, defineArtifactHandoffSupport } from '../../src/index.js';

describe('Artifact Handoff Support', () => {
  it('verifies an exact ArtifactReference', async () => {
    const verify = vi.fn(() => Promise.resolve());
    const support = defineArtifactHandoffSupport({
      runtimeSupportId: 'artifacts.fixture',
      verify,
      materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
    });
    const artifact = artifactReference('artifacts.fixture');

    await support.verify({ artifact });
    expect(verify).toHaveBeenCalledWith({ artifact }, undefined);
    expect(support.kind).toBe(RuntimeSupportKind.ArtifactHandoff);
  });

  it('materializes an owned Artifact into a validated JSON binding', async () => {
    const materialize = vi.fn(() => Promise.resolve({ localPath: '/tmp/model' }));
    const support = defineArtifactHandoffSupport({
      runtimeSupportId: 'artifacts.fixture',
      verify: () => Promise.resolve(),
      materialize,
    });
    const artifact = artifactReference('artifacts.fixture');

    await expect(support.materialize({ artifact })).resolves.toEqual({
      artifactId: artifact.artifactId,
      digest: artifact.digest,
      binding: { localPath: '/tmp/model' },
    });
    expect(materialize).toHaveBeenCalledWith({ artifact }, undefined);
  });

  it('rejects a materialized binding that is not JSON-like', async () => {
    const support = defineArtifactHandoffSupport({
      runtimeSupportId: 'artifacts.fixture',
      verify: () => Promise.resolve(),
      materialize: () => Promise.resolve(undefined),
    });

    await expect(
      support.materialize({ artifact: artifactReference('artifacts.fixture') })
    ).rejects.toBeInstanceOf(InvalidWorkbenchValueError);
  });

  it('rejects references owned by another Artifact Handoff Support', async () => {
    const verify = vi.fn(() => Promise.resolve());
    const support = defineArtifactHandoffSupport({
      runtimeSupportId: 'artifacts.fixture',
      verify,
      materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
    });

    await expect(
      support.verify({ artifact: artifactReference('artifacts.other') })
    ).rejects.toThrow('must equal bound Runtime Support "artifacts.fixture"');
    await expect(
      support.materialize({ artifact: artifactReference('artifacts.other') })
    ).rejects.toThrow('must equal bound Runtime Support "artifacts.fixture"');
    expect(verify).not.toHaveBeenCalled();
  });
});

function artifactReference(runtimeSupportId: string) {
  return parseArtifactReference({
    artifactId: 'artifact:1',
    digest: `sha256:${'a'.repeat(64)}`,
    handoff: {
      runtimeSupportId,
      receipt: { providerObjectId: 'object:1' },
    },
  });
}
