import {
  CapabilityOutcomeStatus,
  JsonValueContract,
  defineArtifactVerifierSupport,
  defineInitializerCapability,
} from '@ta-agent/workbench-extension';
import {
  RuntimeBindingKind,
  type WorkbenchExtensionResources,
  type WorkbenchSetupInput,
} from '@ta-agent/workbench-setup';

const importedModelCapability = defineInitializerCapability({
  capabilityId: 'models.import',
  metadata: { modelFramework: 'shared-fixture' },
  input: JsonValueContract,
  initialize: ({ plannedArtifactId }) =>
    Promise.resolve({
      status: CapabilityOutcomeStatus.Succeeded,
      artifact: {
        artifactId: plannedArtifactId,
        digest: `sha256:${'a'.repeat(64)}`,
      },
    }),
});

const randomModelCapability = defineInitializerCapability({
  capabilityId: 'models.random',
  metadata: { modelFramework: 'shared-fixture' },
  input: JsonValueContract,
  initialize: ({ plannedArtifactId }) =>
    Promise.resolve({
      status: CapabilityOutcomeStatus.Succeeded,
      artifact: {
        artifactId: plannedArtifactId,
        digest: `sha256:${'b'.repeat(64)}`,
      },
    }),
});

const localArtifactVerifier = defineArtifactVerifierSupport({
  runtimeSupportId: 'artifacts.local',
  metadata: { transport: 'local-filesystem' },
  verify: () => Promise.resolve(),
});

const remoteArtifactVerifier = defineArtifactVerifierSupport({
  runtimeSupportId: 'artifacts.remote',
  metadata: { transport: 'remote-object-store' },
  verify: () => Promise.resolve(),
});

export const multiProfileExtensionResources: WorkbenchExtensionResources = {
  modelCapabilities: [importedModelCapability, randomModelCapability],
  runtimeSupports: [localArtifactVerifier, remoteArtifactVerifier],
};

export const multiProfileSetupInput: WorkbenchSetupInput = {
  runtimeBindings: [
    {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'runtime.local',
      supports: { artifactVerifierId: 'artifacts.local' },
      metadata: { environment: 'local-default' },
    },
    {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'runtime.local-isolated',
      supports: { artifactVerifierId: 'artifacts.local' },
      metadata: { environment: 'local-isolated' },
    },
    {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'runtime.remote',
      supports: { artifactVerifierId: 'artifacts.remote' },
      metadata: { environment: 'remote-research' },
    },
  ],
  profiles: [
    {
      profileId: 'research-small',
      initializers: [
        {
          initializerId: 'import',
          capabilityId: 'models.import',
          runtimeBindingId: 'runtime.local',
        },
        {
          initializerId: 'random',
          capabilityId: 'models.random',
          runtimeBindingId: 'runtime.local',
        },
      ],
    },
    {
      profileId: 'research-large',
      initializers: [
        {
          initializerId: 'import',
          capabilityId: 'models.import',
          runtimeBindingId: 'runtime.remote',
        },
        {
          initializerId: 'random',
          capabilityId: 'models.random',
          runtimeBindingId: 'runtime.local-isolated',
        },
      ],
    },
  ],
};
