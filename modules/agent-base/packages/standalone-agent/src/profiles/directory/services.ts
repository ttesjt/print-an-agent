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
import { createStandaloneDirectoryDefinition } from './create-definition.js';
import type {
  CreateStandaloneDirectoryManagementServiceOptions,
  CreateStandaloneDirectoryNavigationServiceOptions,
  CreateStandaloneDirectoryProfileOptions,
  CreateStandaloneDirectorySessionServiceOptions,
} from './types/options.js';

export function createStandaloneDirectoryManagementService(
  options: CreateStandaloneDirectoryManagementServiceOptions
): StandaloneAgentManagementService {
  return projectStandaloneAgentManagementService(
    createAgentManagementService(
      createStandaloneDirectoryDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createStandaloneDirectoryRuntimeService(
  options: CreateStandaloneDirectoryProfileOptions
): StandaloneAgentRuntimeService {
  return projectStandaloneAgentRuntimeService(
    createAgentRuntimeService(createStandaloneDirectoryDefinition(options))
  );
}

export function createStandaloneDirectorySessionService(
  options: CreateStandaloneDirectorySessionServiceOptions
): StandaloneSessionManagementService {
  return projectStandaloneSessionManagementService(
    createSessionManagementService(
      createStandaloneDirectoryDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createStandaloneDirectorySessionNavigationService(
  options: CreateStandaloneDirectoryNavigationServiceOptions
): StandaloneSessionNavigationService {
  return projectStandaloneSessionNavigationService(
    createSessionNavigationService(
      createStandaloneDirectoryDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}
