import {
  CapabilityDispatchKind,
  JsonValueContract,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  ExecutionStatus,
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
  initialize: () =>
    Promise.resolve({
      kind: CapabilityDispatchKind.Completed,
      terminal: {
        status: ExecutionStatus.Succeeded,
        result: {
          artifact: {
            digest: `sha256:${'a'.repeat(64)}`,
            receipt: { location: 'fixture://imported' },
          },
        },
      },
    }),
});

const randomModelCapability = defineInitializerCapability({
  capabilityId: 'models.random',
  metadata: { modelFramework: 'shared-fixture' },
  input: JsonValueContract,
  initialize: () =>
    Promise.resolve({
      kind: CapabilityDispatchKind.Completed,
      terminal: {
        status: ExecutionStatus.Succeeded,
        result: {
          artifact: {
            digest: `sha256:${'b'.repeat(64)}`,
            receipt: { location: 'fixture://random' },
          },
        },
      },
    }),
});

const localArtifactHandoff = defineArtifactHandoffSupport({
  runtimeSupportId: 'artifacts.local',
  metadata: { transport: 'local-filesystem' },
  verify: () => Promise.resolve(),
});

const remoteArtifactHandoff = defineArtifactHandoffSupport({
  runtimeSupportId: 'artifacts.remote',
  metadata: { transport: 'remote-object-store' },
  verify: () => Promise.resolve(),
});

const localExecution = defineExecutionSupport({
  runtimeSupportId: 'execution.local',
  observe: () => Promise.reject(new Error('No detached local execution is expected.')),
  cancel: () => Promise.resolve(),
});

const remoteExecution = defineExecutionSupport({
  runtimeSupportId: 'execution.remote',
  observe: () => Promise.reject(new Error('No detached remote execution is expected.')),
  cancel: () => Promise.resolve(),
});

export const multiProfileExtensionResources: WorkbenchExtensionResources = {
  modelCapabilities: [importedModelCapability, randomModelCapability],
  runtimeSupports: [localArtifactHandoff, remoteArtifactHandoff, localExecution, remoteExecution],
};

export const multiProfileSetupInput: WorkbenchSetupInput = {
  runtimeBindings: [
    {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'runtime.local',
      supports: {
        artifactHandoffId: 'artifacts.local',
        executionSupportId: 'execution.local',
      },
      metadata: { environment: 'local-default' },
    },
    {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'runtime.local-isolated',
      supports: {
        artifactHandoffId: 'artifacts.local',
        executionSupportId: 'execution.local',
      },
      metadata: { environment: 'local-isolated' },
    },
    {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'runtime.remote',
      supports: {
        artifactHandoffId: 'artifacts.remote',
        executionSupportId: 'execution.remote',
      },
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
