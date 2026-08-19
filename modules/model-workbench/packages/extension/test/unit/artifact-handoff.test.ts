import { describe, expect, it, vi } from 'vitest';

import { parseArtifactReference } from '@ta-agent/workbench-domain';

import { RuntimeSupportKind, defineArtifactHandoffSupport } from '../../src/index.js';

describe('Artifact Handoff Support', () => {
  it('verifies an exact ArtifactReference', async () => {
    const verify = vi.fn(() => Promise.resolve());
    const support = defineArtifactHandoffSupport({
      runtimeSupportId: 'artifacts.fixture',
      verify,
    });
    const artifact = artifactReference('artifacts.fixture');

    await support.verify({ artifact });
    expect(verify).toHaveBeenCalledWith({ artifact }, undefined);
    expect(support.kind).toBe(RuntimeSupportKind.ArtifactHandoff);
  });

  it('rejects references owned by another Artifact Handoff Support', async () => {
    const verify = vi.fn(() => Promise.resolve());
    const support = defineArtifactHandoffSupport({
      runtimeSupportId: 'artifacts.fixture',
      verify,
    });

    await expect(
      support.verify({ artifact: artifactReference('artifacts.other') })
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
