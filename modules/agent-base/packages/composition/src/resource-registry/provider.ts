import { ResourceError } from './errors.js';
import { assertName, assertWiringRecord, canonicalJson, snapshotJson } from './json.js';
import { ResourceToken, isThenable, type ResourceTokenIdentity } from './token.js';
import type { ResourceJson } from './types/json.js';
import type { PreparedProvider, ProviderDriver } from './types/provider.js';
import type { ResourceAcquisition } from './types/scope.js';

export interface ResourceDescription {
  readonly key: string;
  readonly descriptor: ResourceJson;
}

export class ResourceDependency<B, V> {
  declare private readonly valueType: () => V;
  constructor(
    readonly token: ResourceTokenIdentity,
    readonly prepare: (binding: B) => {
      readonly binding: unknown;
      readonly accept: (value: unknown) => V;
    }
  ) {
    Object.freeze(this);
  }
}

export function resourceDependency<B, DB, V>(
  token: ResourceToken<DB, V>,
  binding: (parent: B) => DB
): ResourceDependency<B, V> {
  return new ResourceDependency(token, (parent) => {
    const parsed = token.parse(binding(parent));
    return { binding: parsed, accept: (value) => token.accept(value, parsed) };
  });
}

export type ResourceDependencies<B> = Readonly<Record<string, ResourceDependency<B, unknown>>>;
export type ResolvedResourceDependencies<D> = {
  readonly [K in keyof D]: D[K] extends ResourceDependency<never, infer V> ? V : never;
};

const providerBrand: unique symbol = Symbol('ResourceProvider');
export interface ResourceProvider {
  readonly [providerBrand]: true;
}
const drivers = new WeakMap<ResourceProvider, ProviderDriver>();

/**
 * Declares construction and lifetime dependencies, including dependencies retained by a Service
 * or used by its release callback. A closed-over reference alone is not a recorded dependency.
 * Providers receive resolved named dependencies, never ambient Registry access.
 */
export function defineResourceProvider<B, V, const D extends ResourceDependencies<B>>(input: {
  readonly token: ResourceToken<B, V>;
  readonly describe: (binding: B) => ResourceDescription;
  readonly dependencies: D;
  readonly create: (input: {
    readonly binding: B;
    readonly dependencies: ResolvedResourceDependencies<D>;
    readonly signal: AbortSignal;
  }) => ResourceAcquisition<V> | Promise<ResourceAcquisition<V>>;
  readonly validate?: (value: V, binding: B) => void;
  readonly externalBinding?: 'forbidden' | 'borrowed';
}): ResourceProvider {
  assertWiringRecord(input, [
    'token',
    'describe',
    'dependencies',
    'create',
    'validate',
    'externalBinding',
  ]);
  if (
    !(input.token instanceof ResourceToken) ||
    typeof input.describe !== 'function' ||
    typeof input.create !== 'function' ||
    (input.validate !== undefined && typeof input.validate !== 'function') ||
    (input.externalBinding !== undefined &&
      input.externalBinding !== 'forbidden' &&
      input.externalBinding !== 'borrowed')
  ) {
    throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A resource provider is invalid.');
  }
  const { token, describe, create, validate } = input;
  assertWiringRecord(input.dependencies);
  const dependencies = Object.entries(input.dependencies).map(([name, dependency]) => {
    assertName(name);
    if (
      !(dependency instanceof ResourceDependency) ||
      !(dependency.token instanceof ResourceToken)
    ) {
      throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A resource dependency is invalid.');
    }
    return Object.freeze({ name, dependency });
  });
  const provider: ResourceProvider = Object.freeze({ [providerBrand]: true as const });
  drivers.set(
    provider,
    Object.freeze({
      token,
      dependencyTokens: Object.freeze(dependencies.map(({ dependency }) => dependency.token)),
      externalBinding: input.externalBinding ?? 'forbidden',
      prepare(rawBinding: unknown): PreparedProvider {
        const binding = token.parse(rawBinding);
        const description = describe(binding);
        assertWiringRecord(description, ['key', 'descriptor']);
        assertName(description.key);
        const descriptor = canonicalJson(snapshotJson(description.descriptor));
        const prepared = dependencies.map(({ name, dependency }) => ({
          name,
          dependency,
          request: dependency.prepare(binding),
        }));
        return {
          key: description.key,
          descriptor,
          dependencies: prepared.map(({ name, dependency, request }) => ({
            name,
            token: dependency.token,
            binding: request.binding,
          })),
          async create(values, signal) {
            // Every named entry is produced by its own typed dependency contract, not a dictionary cast of arbitrary values.
            const resolved = Object.fromEntries(
              prepared.map(({ name, request }) => [name, request.accept(values[name])])
            ) as ResolvedResourceDependencies<D>;
            const produced = create({
              binding,
              dependencies: Object.freeze(resolved),
              signal,
            });
            // Box synchronous acquisitions before crossing a Promise boundary: malformed thenable
            // acquisitions must reach the ownership ledger without implicitly running their then().
            const acquisition =
              !(produced instanceof Promise) &&
              produced !== null &&
              typeof produced === 'object' &&
              ('value' in produced || 'release' in produced)
                ? produced
                : await produced;
            return { acquisition };
          },
          async validate(value) {
            const accepted = token.accept(value, binding);
            const outcome: unknown = validate?.(accepted, binding);
            if (isThenable(outcome)) {
              let cause: unknown;
              // A void callback can accidentally be async in TypeScript. Join it before release,
              // but never accept it as a valid synchronous identity check.
              try {
                await outcome;
              } catch (error) {
                cause = error;
              }
              throw new ResourceError(
                'RESOURCE_INITIALIZATION_FAILED',
                'Resource validation must be synchronous.',
                { cause }
              );
            }
          },
        };
      },
    })
  );
  return provider;
}

export function providerDriver(provider: ResourceProvider): ProviderDriver {
  const driver = drivers.get(provider);
  if (driver === undefined)
    throw new ResourceError(
      'RESOURCE_BLUEPRINT_INVALID',
      'A provider was not defined by this package.'
    );
  return driver;
}
