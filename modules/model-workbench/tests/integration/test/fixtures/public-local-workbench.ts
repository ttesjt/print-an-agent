import { createModelWorkbench } from '@ta-agent/workbench-application';
import {
  JsonValueContract,
  defineExporterCapability,
  defineInitializerCapability,
  defineOutputInvokerCapability,
  defineTrainerCapability,
} from '@ta-agent/workbench-extension';
import {
  createLocalArtifactHandoffSupport,
  createLocalCommandBridge,
  createLocalExecutionSupport,
  createLocalOutputInvocationBridge,
} from '@ta-agent/workbench-local-runtime';
import {
  createSqliteProfilePersistenceAdapter,
  type SqliteProfilePersistenceAdapter,
} from '@ta-agent/workbench-persistence';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';

export interface PublicLocalWorkbenchOptions {
  readonly rootDirectory: string;
  readonly databasePath: string;
  readonly backendExecutable: string;
  readonly backendPath: string;
  readonly idSource?: {
    nextId(kind: 'run' | 'base' | 'modification' | 'output' | 'artifact'): string;
  };
}

export function createPublicLocalWorkbench(options: PublicLocalWorkbenchOptions): Readonly<{
  workbench: ReturnType<typeof createModelWorkbench>;
  persistence: SqliteProfilePersistenceAdapter;
}> {
  const command = {
    executable: options.backendExecutable,
    arguments: [options.backendPath],
  };
  const operationBridge = createLocalCommandBridge({
    rootDirectory: options.rootDirectory,
    command,
  });
  const invocationBridge = createLocalOutputInvocationBridge({ command });
  const persistence = createSqliteProfilePersistenceAdapter({
    resolveDatabasePath: () => options.databasePath,
  });
  const setup = {
    runtimeBindings: [
      {
        kind: RuntimeBindingKind.Binding,
        runtimeBindingId: 'runtime.local',
        supports: {
          artifactHandoffId: 'artifacts.local',
          executionSupportId: 'execution.local',
        },
      },
    ],
    profiles: [
      {
        profileId: 'profile.local-product',
        initializers: [
          {
            initializerId: 'initialize',
            capabilityId: 'capability.initialize',
            runtimeBindingId: 'runtime.local',
          },
        ],
        trainers: [
          {
            trainerId: 'train',
            capabilityId: 'capability.train',
            runtimeBindingId: 'runtime.local',
          },
        ],
        exporters: [
          {
            exporterId: 'export',
            capabilityId: 'capability.export',
            runtimeBindingId: 'runtime.local',
          },
        ],
        outputInvokers: [
          {
            outputInvokerId: 'invoke',
            capabilityId: 'capability.invoke',
            runtimeBindingId: 'runtime.local',
          },
        ],
      },
    ],
  };
  const extensions = {
    modelCapabilities: [
      defineInitializerCapability({
        capabilityId: 'capability.initialize',
        input: JsonValueContract,
        initialize: (request, callOptions) => operationBridge.dispatch(request, callOptions),
      }),
      defineTrainerCapability({
        capabilityId: 'capability.train',
        input: JsonValueContract,
        resultData: JsonValueContract,
        train: (request, callOptions) => operationBridge.dispatch(request, callOptions),
      }),
      defineExporterCapability({
        capabilityId: 'capability.export',
        input: JsonValueContract,
        resultData: JsonValueContract,
        export: (request, callOptions) => operationBridge.dispatch(request, callOptions),
      }),
      defineOutputInvokerCapability({
        capabilityId: 'capability.invoke',
        input: JsonValueContract,
        output: JsonValueContract,
        invoke: (request, callOptions) => invocationBridge.invoke(request, callOptions),
      }),
    ],
    runtimeSupports: [
      createLocalArtifactHandoffSupport({
        runtimeSupportId: 'artifacts.local',
        rootDirectory: options.rootDirectory,
      }),
      createLocalExecutionSupport({
        runtimeSupportId: 'execution.local',
        rootDirectory: options.rootDirectory,
      }),
    ],
  };
  return Object.freeze({
    workbench: createModelWorkbench({
      setup,
      extensions,
      persistence,
      ...(options.idSource === undefined ? {} : { idSource: options.idSource }),
    }),
    persistence,
  });
}
