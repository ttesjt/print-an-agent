import { ResourceError } from './errors.js';
import { assertWiringRecord } from './json.js';
import { ResourceToken, type ResourceRequest, type ResourceTokenIdentity } from './token.js';
import type { PreparedProvider, ProviderDriver } from './types/provider.js';

const bindingBrand: unique symbol = Symbol('ResourceExternalBinding');
/** An explicit borrowed value, not an acquisition or an imported Registry. */
export interface ResourceExternalBinding {
  readonly [bindingBrand]: true;
}

interface SuppliedResource {
  readonly token: ResourceTokenIdentity;
  readonly binding: unknown;
  readonly value: unknown;
}
const supplied = new WeakMap<ResourceExternalBinding, SuppliedResource>();

export function borrowResource<B, V>(
  request: ResourceRequest<B, V>,
  value: NoInfer<V>
): ResourceExternalBinding {
  assertWiringRecord(request, ['token', 'binding']);
  if (!(request.token instanceof ResourceToken)) throw invalidBinding();
  const binding: ResourceExternalBinding = Object.freeze({ [bindingBrand]: true as const });
  supplied.set(binding, {
    token: request.token,
    binding: request.token.parse(request.binding),
    value,
  });
  return binding;
}

export interface PreparedExternalBinding {
  readonly prepared: PreparedProvider;
  readonly value: unknown;
}

/** Copy wiring only. Value guards run lazily; live objects are never cloned or frozen. */
export function prepareExternalBindings(
  providers: ReadonlyMap<ResourceTokenIdentity, ProviderDriver>,
  bindings: readonly ResourceExternalBinding[]
): Map<ResourceTokenIdentity, Map<string, PreparedExternalBinding>> {
  if (!isBindingList(bindings) || Reflect.ownKeys(bindings).length !== bindings.length + 1)
    throw invalidBinding();
  const prepared = new Map<ResourceTokenIdentity, Map<string, PreparedExternalBinding>>();
  for (let index = 0; index < bindings.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(bindings, index);
    if (slot === undefined || !('value' in slot) || !slot.enumerable) throw invalidBinding();
    const input = supplied.get(bindings[index]!);
    if (input === undefined) throw invalidBinding();
    const driver = providers.get(input.token);
    if (
      driver === undefined ||
      driver.externalBinding !== 'borrowed' ||
      driver.dependencyTokens.length !== 0
    )
      throw invalidBinding();
    let resource: PreparedProvider;
    try {
      resource = driver.prepare(input.binding);
    } catch (cause) {
      throw invalidBinding(cause);
    }
    let slots = prepared.get(input.token);
    const duplicate = slots?.get(resource.key);
    if (duplicate !== undefined) {
      if (duplicate.prepared.descriptor !== resource.descriptor)
        throw new ResourceError(
          'RESOURCE_BINDING_CONFLICT',
          'External bindings disagree on a resource identity.'
        );
      throw invalidBinding();
    }
    if (slots === undefined) {
      slots = new Map();
      prepared.set(input.token, slots);
    }
    slots.set(resource.key, { prepared: resource, value: input.value });
  }
  return prepared;
}

function isBindingList(value: unknown): value is readonly ResourceExternalBinding[] {
  return Array.isArray(value);
}

function invalidBinding(cause?: unknown): ResourceError {
  return new ResourceError(
    'RESOURCE_EXTERNAL_BINDING_INVALID',
    'An external resource binding is invalid or not permitted.',
    { cause }
  );
}
