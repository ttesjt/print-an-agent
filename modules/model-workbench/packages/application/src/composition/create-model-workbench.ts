import {
  createWorkbenchControlPlane,
  type ModelWorkbenchControlPlane,
} from '@print-an-agent/workbench-control-plane';
import { createMemoryProfilePersistenceAdapter } from '@print-an-agent/workbench-persistence';
import { resolveWorkbenchSetup } from '@print-an-agent/workbench-setup';

import type { ModelWorkbenchApplicationConfiguration } from './contracts.js';
import { createRandomWorkbenchIdSource, createSystemWorkbenchClock } from './defaults.js';

export function createModelWorkbench(
  configuration: ModelWorkbenchApplicationConfiguration
): ModelWorkbenchControlPlane {
  const setup = resolveWorkbenchSetup(configuration.setup, configuration.extensions);

  return createWorkbenchControlPlane({
    setup,
    persistence: configuration.persistence ?? createMemoryProfilePersistenceAdapter(),
    idSource: configuration.idSource ?? createRandomWorkbenchIdSource(),
    clock: configuration.clock ?? createSystemWorkbenchClock(),
  });
}
