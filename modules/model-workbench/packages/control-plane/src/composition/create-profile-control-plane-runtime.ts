import { ModelOperationKind } from '@ta-agent/workbench-domain';
import type { ProfilePersistence } from '@ta-agent/workbench-persistence';
import type { ResolvedModelProfile } from '@ta-agent/workbench-setup';

import type { WorkbenchControlPlaneConfiguration } from './contracts.js';
import { createExecutionLifecycle } from '../execution/create-execution-lifecycle.js';
import type { ExecutionLifecycle } from '../execution/contracts.js';
import { createModelStateMaterializer } from '../model-states/materialize-model-state.js';
import { createExportExecutionHandler } from '../operations/export/export-execution-handler.js';
import { createStartExport } from '../operations/export/start-export.js';
import { createInitializationExecutionHandler } from '../operations/initialization/initialization-execution-handler.js';
import { createStartInitialization } from '../operations/initialization/start-initialization.js';
import { createInvokeOutput } from '../operations/output-invocation/invoke-output.js';
import { createOutputMaterializer } from '../operations/output-invocation/materialize-output.js';
import { createTrainingExecutionHandler } from '../operations/training/training-execution-handler.js';
import { createStartTraining } from '../operations/training/start-training.js';

export interface ProfileControlPlaneRuntime {
  readonly profile: ResolvedModelProfile;
  readonly persistence: ProfilePersistence;
  readonly lifecycle: ExecutionLifecycle;
  readonly startInitialization: ReturnType<typeof createStartInitialization>;
  readonly startTraining: ReturnType<typeof createStartTraining>;
  readonly startExport: ReturnType<typeof createStartExport>;
  readonly invokeOutput: ReturnType<typeof createInvokeOutput>;
}

export function createProfileControlPlaneRuntime(
  configuration: WorkbenchControlPlaneConfiguration,
  profile: ResolvedModelProfile,
  persistence: ProfilePersistence
): ProfileControlPlaneRuntime {
  const materializeModelState = createModelStateMaterializer({
    artifactHandoffSupports: profile.artifactHandoffSupports,
    parameters: persistence.parameters,
  });
  const initializationHandler = createInitializationExecutionHandler({
    setup: configuration.setup,
    initializationCommitter: persistence.commits.initialization,
    runs: persistence.runs,
    idSource: configuration.idSource,
    clock: configuration.clock,
  });
  const trainingHandler = createTrainingExecutionHandler({
    setup: configuration.setup,
    trainingCommitter: persistence.commits.training,
    runs: persistence.runs,
    materializeModelState,
    idSource: configuration.idSource,
    clock: configuration.clock,
  });
  const exportHandler = createExportExecutionHandler({
    setup: configuration.setup,
    exportCommitter: persistence.commits.export,
    runs: persistence.runs,
    materializeModelState,
    idSource: configuration.idSource,
    clock: configuration.clock,
  });
  const lifecycle = createExecutionLifecycle({
    profileId: profile.profileId,
    runs: persistence.runs,
    handlers: {
      [ModelOperationKind.Initialization]: initializationHandler,
      [ModelOperationKind.Training]: trainingHandler,
      [ModelOperationKind.Export]: exportHandler,
    },
  });
  return Object.freeze({
    profile,
    persistence,
    lifecycle,
    startInitialization: createStartInitialization({
      setup: configuration.setup,
      runs: persistence.runs,
      handler: initializationHandler,
      idSource: configuration.idSource,
      clock: configuration.clock,
    }),
    startTraining: createStartTraining({
      setup: configuration.setup,
      runs: persistence.runs,
      handler: trainingHandler,
      idSource: configuration.idSource,
      clock: configuration.clock,
    }),
    startExport: createStartExport({
      setup: configuration.setup,
      runs: persistence.runs,
      handler: exportHandler,
      idSource: configuration.idSource,
      clock: configuration.clock,
    }),
    invokeOutput: createInvokeOutput({
      profile,
      outputs: persistence.outputs,
      materializeOutput: createOutputMaterializer(profile),
    }),
  });
}
