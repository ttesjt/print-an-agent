import { ModelOperationKind, parseBaseId } from '@ta-agent/workbench-domain';

import type {
  ModelWorkbenchControlPlane,
  WorkbenchControlPlaneConfiguration,
} from './contracts.js';
import { createExecutionLifecycle } from '../execution/create-execution-lifecycle.js';
import { createStartInitialization } from '../operations/initialization/start-initialization.js';
import { createInitializationExecutionHandler } from '../operations/initialization/initialization-execution-handler.js';

export function createWorkbenchControlPlane(
  configuration: WorkbenchControlPlaneConfiguration
): ModelWorkbenchControlPlane {
  const initializationHandler = createInitializationExecutionHandler({
    setup: configuration.setup,
    initializationCommitter: configuration.persistence.commits.initialization,
    idSource: configuration.idSource,
  });
  const lifecycle = createExecutionLifecycle({
    runs: configuration.persistence.runs,
    handlers: { [ModelOperationKind.Initialization]: initializationHandler },
  });
  const startInitialization = createStartInitialization({
    setup: configuration.setup,
    runs: configuration.persistence.runs,
    lifecycle,
    handler: initializationHandler,
    idSource: configuration.idSource,
  });

  return Object.freeze({
    setup: Object.freeze({ evidenceDigest: configuration.setup.evidenceDigest }),
    initialization: Object.freeze({ start: startInitialization }),
    runs: lifecycle.runs,
    models: Object.freeze({
      getBase: (baseId: string) =>
        configuration.persistence.parameters.findBase(parseBaseId(baseId, 'baseId')),
    }),
  });
}
