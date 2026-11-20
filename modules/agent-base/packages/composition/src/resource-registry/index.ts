export { borrowResource, type ResourceExternalBinding } from './bindings.js';
export { compileResourceBlueprint, type ResourceBlueprint } from './blueprint.js';
export { ResourceCleanupError, ResourceError, type ResourceErrorCode } from './errors.js';
export type { ResourceJson } from './types/json.js';
export type {
  ResourceAcquisition,
  ResourceCallOptions,
  ResourceCloseOptions,
  ResourceRegistry,
  ResourceScope,
  ResourceScopeOptions,
  ResourceScopeState,
} from './types/scope.js';

export {
  defineResourceProvider,
  resourceDependency,
  type ResolvedResourceDependencies,
  type ResourceDependencies,
  type ResourceDescription,
  type ResourceProvider,
} from './provider.js';

export { bindResourceScope, createResourceScope } from './scope.js';
export { ResourceToken, type ResourceRequest } from './token.js';
