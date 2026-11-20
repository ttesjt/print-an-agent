import {
  CONTEXT_MEMORY_MANAGEMENT_OPERATIONS,
  RETRIEVAL_MEMORY_MANAGEMENT_OPERATIONS,
} from '../memory/index.js';
import {
  requireClosedRecord,
  requireDataProperty,
  requireFunction,
  type UnknownRecord,
} from './validation.js';

export function installDefinitionCapabilities(
  root: UnknownRecord,
  definition: Record<string, unknown>
): void {
  if (Object.hasOwn(root, 'sessionManagement')) {
    const sessionManagement = requireClosedRecord(
      requireDataProperty(root, 'sessionManagement', 'sessionManagement'),
      'sessionManagement',
      ['createPorts']
    );
    const createSessionManagementPorts = requireDataProperty(
      sessionManagement,
      'createPorts',
      'sessionManagement.createPorts'
    );
    requireFunction(createSessionManagementPorts, 'sessionManagement.createPorts');
    definition.sessionManagement = Object.freeze({
      createPorts: createSessionManagementPorts,
    });
  }

  if (Object.hasOwn(root, 'sessionNavigation')) {
    const sessionNavigation = requireClosedRecord(
      requireDataProperty(root, 'sessionNavigation', 'sessionNavigation'),
      'sessionNavigation',
      ['createPorts']
    );
    const createSessionNavigationPorts = requireDataProperty(
      sessionNavigation,
      'createPorts',
      'sessionNavigation.createPorts'
    );
    requireFunction(createSessionNavigationPorts, 'sessionNavigation.createPorts');
    definition.sessionNavigation = Object.freeze({
      createPorts: createSessionNavigationPorts,
    });
  }

  for (const [name, methods] of [
    ['contextMemoryManagement', CONTEXT_MEMORY_MANAGEMENT_OPERATIONS],
    ['retrievalMemoryManagement', RETRIEVAL_MEMORY_MANAGEMENT_OPERATIONS],
  ] as const) {
    if (!Object.hasOwn(root, name)) continue;
    const capability = requireClosedRecord(requireDataProperty(root, name, name), name, [
      'resolve',
    ]);
    const resolve = requireClosedRecord(
      requireDataProperty(capability, 'resolve', `${name}.resolve`),
      `${name}.resolve`,
      methods
    );
    const factories: Record<string, unknown> = {};
    for (const method of methods) {
      const factory = requireDataProperty(resolve, method, `${name}.resolve.${method}`);
      requireFunction(factory, `${name}.resolve.${method}`);
      factories[method] = factory;
    }
    definition[name] = Object.freeze({ resolve: Object.freeze(factories) });
  }
}
