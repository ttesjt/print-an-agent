import { ResourceError } from './errors.js';
import { providerDriver, type ProviderDriver, type ResourceProvider } from './provider.js';
import type { ResourceTokenIdentity } from './token.js';

const blueprintBrand: unique symbol = Symbol('ResourceBlueprint');
export interface ResourceBlueprint {
  readonly [blueprintBrand]: true;
}
const blueprints = new WeakMap<
  ResourceBlueprint,
  ReadonlyMap<ResourceTokenIdentity, ProviderDriver>
>();

export function compileResourceBlueprint(
  providers: readonly ResourceProvider[]
): ResourceBlueprint {
  if (!isList(providers))
    throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'Providers must be a list.');
  if (Reflect.ownKeys(providers).length !== providers.length + 1) {
    throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'Providers must be a dense data list.');
  }
  for (let index = 0; index < providers.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(providers, index);
    if (slot === undefined || !('value' in slot) || !slot.enumerable) {
      throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'Provider accessors are not allowed.');
    }
  }
  const compiled = new Map<ResourceTokenIdentity, ProviderDriver>();
  for (const provider of providers) {
    const driver = providerDriver(provider);
    if (compiled.has(driver.token))
      throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A token has multiple providers.');
    compiled.set(driver.token, driver);
  }
  const visiting = new Set<ResourceTokenIdentity>();
  const visited = new Set<ResourceTokenIdentity>();
  function visit(token: ResourceTokenIdentity): void {
    if (visiting.has(token))
      throw new ResourceError('RESOURCE_DEPENDENCY_CYCLE', 'The resource graph contains a cycle.');
    if (visited.has(token)) return;
    const driver = compiled.get(token);
    if (driver === undefined)
      throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A dependency has no provider.');
    visiting.add(token);
    for (const dependency of driver.dependencyTokens) visit(dependency);
    visiting.delete(token);
    visited.add(token);
  }
  for (const token of compiled.keys()) visit(token);
  const blueprint: ResourceBlueprint = Object.freeze({ [blueprintBrand]: true as const });
  blueprints.set(blueprint, compiled);
  return blueprint;
}

function isList(value: unknown): value is readonly ResourceProvider[] {
  return Array.isArray(value);
}

export function blueprintProviders(
  blueprint: ResourceBlueprint
): ReadonlyMap<ResourceTokenIdentity, ProviderDriver> {
  const providers = blueprints.get(blueprint);
  if (providers === undefined)
    throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'The resource blueprint is invalid.');
  return providers;
}
