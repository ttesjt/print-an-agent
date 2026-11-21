import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
} from '@print-an-agent/base-composition';
import {
  projectStandaloneAgentManagementService,
  projectStandaloneAgentRuntimeService,
  projectStandaloneSessionManagementService,
  projectStandaloneSessionNavigationService,
  type StandaloneAgentManagementService,
  type StandaloneAgentRuntimeService,
  type StandaloneSessionManagementService,
  type StandaloneSessionNavigationService,
} from '../../service-projections/index.js';
import { createSharedSqliteStandaloneDefinition } from './create-definition.js';
import type {
  CreateSharedSqliteStandaloneManagementServiceOptions,
  CreateSharedSqliteStandaloneNavigationServiceOptions,
  CreateSharedSqliteStandaloneProfileOptions,
  CreateSharedSqliteStandaloneSessionServiceOptions,
} from './types/options.js';

export function createSharedSqliteStandaloneManagementService(
  options: CreateSharedSqliteStandaloneManagementServiceOptions
): StandaloneAgentManagementService {
  return projectStandaloneAgentManagementService(
    createAgentManagementService(
      createSharedSqliteStandaloneDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createSharedSqliteStandaloneRuntimeService(
  options: CreateSharedSqliteStandaloneProfileOptions
): StandaloneAgentRuntimeService {
  return projectStandaloneAgentRuntimeService(
    createAgentRuntimeService(createSharedSqliteStandaloneDefinition(options))
  );
}

export function createSharedSqliteStandaloneSessionService(
  options: CreateSharedSqliteStandaloneSessionServiceOptions
): StandaloneSessionManagementService {
  return projectStandaloneSessionManagementService(
    createSessionManagementService(
      createSharedSqliteStandaloneDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createSharedSqliteStandaloneSessionNavigationService(
  options: CreateSharedSqliteStandaloneNavigationServiceOptions
): StandaloneSessionNavigationService {
  return projectStandaloneSessionNavigationService(
    createSessionNavigationService(
      createSharedSqliteStandaloneDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}
