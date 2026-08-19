import {
  defineModelState,
  ModelOperationKind,
  parseBaseId,
  parseModificationId,
} from '@ta-agent/workbench-domain';

import type {
  ModelWorkbenchControlPlane,
  WorkbenchControlPlaneConfiguration,
} from './contracts.js';
import { createExecutionLifecycle } from '../execution/create-execution-lifecycle.js';
import { createStartInitialization } from '../operations/initialization/start-initialization.js';
import { createInitializationExecutionHandler } from '../operations/initialization/initialization-execution-handler.js';
import { createPrepareTrainingSource } from '../operations/training/prepare-training-source.js';
import { createStartTraining } from '../operations/training/start-training.js';
import { createTrainingExecutionHandler } from '../operations/training/training-execution-handler.js';

export function createWorkbenchControlPlane(
  configuration: WorkbenchControlPlaneConfiguration
): ModelWorkbenchControlPlane {
  const initializationHandler = createInitializationExecutionHandler({
    setup: configuration.setup,
    initializationCommitter: configuration.persistence.commits.initialization,
    idSource: configuration.idSource,
  });
  const trainingHandler = createTrainingExecutionHandler({
    setup: configuration.setup,
    trainingCommitter: configuration.persistence.commits.training,
    idSource: configuration.idSource,
  });
  const lifecycle = createExecutionLifecycle({
    runs: configuration.persistence.runs,
    handlers: {
      [ModelOperationKind.Initialization]: initializationHandler,
      [ModelOperationKind.Training]: trainingHandler,
    },
  });
  const startInitialization = createStartInitialization({
    setup: configuration.setup,
    runs: configuration.persistence.runs,
    lifecycle,
    handler: initializationHandler,
    idSource: configuration.idSource,
  });
  const startTraining = createStartTraining({
    setup: configuration.setup,
    runs: configuration.persistence.runs,
    lifecycle,
    handler: trainingHandler,
    prepareSource: createPrepareTrainingSource({
      setup: configuration.setup,
      parameters: configuration.persistence.parameters,
    }),
    idSource: configuration.idSource,
  });

  return Object.freeze({
    setup: Object.freeze({ evidenceDigest: configuration.setup.evidenceDigest }),
    initialization: Object.freeze({ start: startInitialization }),
    training: Object.freeze({ start: startTraining }),
    runs: lifecycle.runs,
    models: Object.freeze({
      compose: defineModelState,
      getBase: (baseId: string) =>
        configuration.persistence.parameters.findBase(parseBaseId(baseId, 'baseId')),
      getModification: (modificationId: string) =>
        configuration.persistence.parameters.findModification(
          parseModificationId(modificationId, 'modificationId')
        ),
    }),
  });
}
