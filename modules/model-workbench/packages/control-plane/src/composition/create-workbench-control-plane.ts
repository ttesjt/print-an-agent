import { parseBaseId, parseRunId } from '@ta-agent/workbench-domain';

import type {
  ModelWorkbenchControlPlane,
  WorkbenchControlPlaneConfiguration,
} from './contracts.js';
import { createStartInitialization } from '../operations/initialization/start-initialization.js';

export function createWorkbenchControlPlane(
  configuration: WorkbenchControlPlaneConfiguration
): ModelWorkbenchControlPlane {
  const startInitialization = createStartInitialization({
    setup: configuration.setup,
    runs: configuration.persistence.runs,
    initializationCommitter: configuration.persistence.commits.initialization,
    idSource: configuration.idSource,
  });

  return Object.freeze({
    setup: Object.freeze({ evidenceDigest: configuration.setup.evidenceDigest }),
    initialization: Object.freeze({ start: startInitialization }),
    runs: Object.freeze({
      get: (runId: string) => configuration.persistence.runs.find(parseRunId(runId, 'runId')),
    }),
    models: Object.freeze({
      getBase: (baseId: string) =>
        configuration.persistence.parameters.findBase(parseBaseId(baseId, 'baseId')),
    }),
  });
}
