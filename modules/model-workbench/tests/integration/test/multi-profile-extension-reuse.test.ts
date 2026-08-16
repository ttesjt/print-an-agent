import { describe, expect, it } from 'vitest';

import { resolveWorkbenchSetup } from '@ta-agent/workbench-setup';

import {
  multiProfileExtensionResources,
  multiProfileSetupInput,
} from './fixtures/multi-profile-extension-setup.js';

describe('multi-Profile Extension Runtime reuse', () => {
  it('reuses Capability, Binding, and Runtime Support objects without operation-time lookup', () => {
    const setup = resolveWorkbenchSetup(multiProfileSetupInput, multiProfileExtensionResources);
    const small = setup.profiles.find(({ profileId }) => profileId === 'research-small');
    const large = setup.profiles.find(({ profileId }) => profileId === 'research-large');
    const smallImport = small?.initializers.find(({ initializerId }) => initializerId === 'import');
    const smallRandom = small?.initializers.find(({ initializerId }) => initializerId === 'random');
    const largeImport = large?.initializers.find(({ initializerId }) => initializerId === 'import');
    const largeRandom = large?.initializers.find(({ initializerId }) => initializerId === 'random');

    if (
      smallImport === undefined ||
      smallRandom === undefined ||
      largeImport === undefined ||
      largeRandom === undefined
    ) {
      throw new Error('Expected all fixture Initializer slots to resolve.');
    }

    // One Capability Runtime can be selected by slots in several Profiles.
    expect(smallImport.capability).toBe(largeImport.capability);
    expect(smallRandom.capability).toBe(largeRandom.capability);

    // One exact Runtime Binding can be selected by several slots.
    expect(smallImport.runtime).toBe(smallRandom.runtime);

    // Several Runtime Bindings can reuse the same Runtime Support Runtime.
    expect(smallImport.runtime).not.toBe(largeRandom.runtime);
    expect(smallImport.runtime.supports.artifactVerifier).toBe(
      largeRandom.runtime.supports.artifactVerifier
    );

    // A reused Capability can still be paired with a different Runtime Binding per Profile.
    expect(smallImport.runtime).not.toBe(largeImport.runtime);
    expect(smallImport.runtime.supports.artifactVerifier).not.toBe(
      largeImport.runtime.supports.artifactVerifier
    );
  });
});
