import { prepareExternalBindings, type PreparedExternalBinding } from './bindings.js';
import { blueprintProviders, type ResourceBlueprint } from './blueprint.js';
import { ResourceCleanupError, ResourceError } from './errors.js';
import { assertWiringRecord } from './json.js';
import { AcquisitionLedger } from './ledger.js';
import {
  ResourceToken,
  isThenable,
  type ResourceRequest,
  type ResourceTokenIdentity,
} from './token.js';
import type { ResourceEntry } from './types/entry.js';
import type { PreparedProvider, ProviderDriver } from './types/provider.js';
import type {
  ResourceCallOptions,
  ResourceCloseOptions,
  ResourceRegistry,
  ResourceScope,
  ResourceScopeOptions,
  ResourceScopeState,
} from './types/scope.js';
import { aborted, waitForResource } from './waiter.js';

class Scope implements ResourceScope {
  readonly #providers: ReadonlyMap<ResourceTokenIdentity, ProviderDriver>;
  readonly #bindings: Map<ResourceTokenIdentity, Map<string, PreparedExternalBinding>>;
  readonly #slots = new Map<ResourceTokenIdentity, Map<string, ResourceEntry>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #controller = new AbortController();
  readonly #ledger = new AcquisitionLedger((error) => this.#fence(error));
  #state: ResourceScopeState = 'open';
  #closing?: Promise<void>;

  constructor(blueprint: ResourceBlueprint, options: ResourceScopeOptions) {
    this.#providers = blueprintProviders(blueprint);
    this.#bindings = prepareExternalBindings(
      this.#providers,
      options.bindings === undefined ? [] : options.bindings
    );
  }

  assertReusable(): void {
    this.#assertAdmission();
  }

  get state(): ResourceScopeState {
    return this.#state;
  }

  readonly registry: ResourceRegistry = Object.freeze({
    lookup: <B, V>(request: ResourceRequest<B, V>, options?: ResourceCallOptions) =>
      this.#request(request, false, options),
    resolve: <B, V>(request: ResourceRequest<B, V>, options?: ResourceCallOptions) =>
      this.#request(request, true, options),
  });

  #request<B, V>(
    request: ResourceRequest<B, V>,
    create: true,
    options?: ResourceCallOptions
  ): Promise<V>;
  #request<B, V>(
    request: ResourceRequest<B, V>,
    create: false,
    options?: ResourceCallOptions
  ): Promise<V | undefined>;
  async #request<B, V>(
    request: ResourceRequest<B, V>,
    create: boolean,
    options?: ResourceCallOptions
  ): Promise<V | undefined> {
    this.#assertAdmission();
    assertWiringRecord(request, ['token', 'binding']);
    if (options !== undefined) assertWiringRecord(options, ['signal']);
    const signal = options?.signal;
    if (!(request.token instanceof ResourceToken))
      throw new ResourceError('RESOURCE_NOT_DECLARED', 'A resource token is invalid.');
    if (signal?.aborted) throw aborted();
    const token = request.token;
    const binding = token.parse(request.binding);
    const entry = this.#entry(token, binding, create, true);
    if (entry === undefined) {
      if (create)
        throw new ResourceError('RESOURCE_INITIALIZATION_FAILED', 'A resource was not resolved.');
      return undefined;
    }
    const value = await waitForResource(entry.promise, signal);
    this.#assertAdmission();
    if (signal?.aborted) throw aborted();
    const accepted = token.accept(value, binding);
    this.#assertAdmission();
    if (signal?.aborted) throw aborted();
    return accepted;
  }

  #entry(
    token: ResourceTokenIdentity,
    binding: unknown,
    create: boolean,
    root = false
  ): ResourceEntry | undefined {
    const driver = this.#providers.get(token);
    if (driver === undefined)
      throw new ResourceError('RESOURCE_NOT_DECLARED', 'The resource has no declared provider.');
    let prepared: PreparedProvider;
    try {
      prepared = driver.prepare(binding);
    } catch (cause) {
      if (cause instanceof ResourceError) throw cause;
      throw new ResourceError(
        'RESOURCE_BINDING_CONFLICT',
        'A resource binding could not be described.',
        { cause }
      );
    }
    if (root) this.#assertAdmission();
    let slots = this.#slots.get(token);
    const existing = slots?.get(prepared.key);
    if (existing !== undefined) {
      if (existing.prepared.descriptor !== prepared.descriptor)
        throw new ResourceError(
          'RESOURCE_BINDING_CONFLICT',
          'A resource key was requested with a different binding.'
        );
      return existing;
    }
    const supplied = this.#bindings.get(token)?.get(prepared.key);
    if (supplied !== undefined && supplied.prepared.descriptor !== prepared.descriptor)
      throw new ResourceError(
        'RESOURCE_BINDING_CONFLICT',
        'An external resource was requested with a different binding.'
      );
    if (!create && supplied === undefined) return undefined;
    if (slots === undefined) {
      slots = new Map();
      this.#slots.set(token, slots);
    }
    const completion = Promise.withResolvers<unknown>();
    const entry: ResourceEntry = {
      token,
      prepared,
      dependencies: new Set(),
      promise: completion.promise,
    };
    slots.set(prepared.key, entry);
    this.#ledger.entries.add(entry);
    this.#pending.add(entry.promise);
    void entry.promise.then(
      () => this.#pending.delete(entry.promise),
      () => this.#pending.delete(entry.promise)
    );
    void this.#initialize(entry, supplied).then(completion.resolve, completion.reject);
    return entry;
  }

  async #initialize(entry: ResourceEntry, supplied?: PreparedExternalBinding): Promise<unknown> {
    let factoryStarted = false;
    try {
      if (supplied !== undefined) {
        // The external owner retains the entire dependency closure and all release duties.
        this.#checkInitialization();
        try {
          await supplied.prepared.validate(supplied.value);
        } catch (cause) {
          throw new ResourceError(
            'RESOURCE_EXTERNAL_BINDING_INVALID',
            'An external resource failed its declared contract.',
            { cause }
          );
        }
        this.#checkInitialization();
        return supplied.value;
      }
      const values: [string, unknown][] = [];
      for (const request of entry.prepared.dependencies) {
        this.#checkInitialization();
        const dependency = this.#entry(request.token, request.binding, true);
        if (dependency === undefined)
          throw new ResourceError(
            'RESOURCE_INITIALIZATION_FAILED',
            'A declared dependency was not resolved.'
          );
        // Record the edge before waiting or passing the dependency into the factory.
        entry.dependencies.add(dependency);
        values.push([request.name, await dependency.promise]);
      }
      this.#checkInitialization();
      factoryStarted = true;
      const acquired = await entry.prepared.create(
        Object.freeze(Object.fromEntries(values)),
        this.#controller.signal
      );
      entry.acquisition = acquired.acquisition;
      this.#ledger.captureRelease(entry);
      // Ownership precedes every post-create check, including malformed acquisition checks.
      if (
        entry.acquisition === null ||
        typeof entry.acquisition !== 'object' ||
        !('value' in entry.acquisition) ||
        isThenable(entry.acquisition)
      ) {
        throw new ResourceError(
          'RESOURCE_INITIALIZATION_FAILED',
          'A provider returned an invalid acquisition.'
        );
      }
      const value = entry.acquisition.value;
      await entry.prepared.validate(value);
      this.#checkInitialization();
      return value;
    } catch (primary) {
      let failure: unknown = primary;
      if (entry.acquisition !== undefined) {
        try {
          await this.#ledger.release(entry, primary);
        } catch (cleanup) {
          failure = cleanup;
        }
      }
      if (
        failure instanceof ResourceError &&
        failure.code === 'RESOURCE_CLEANUP_FAILED' &&
        factoryStarted
      ) {
        const cleanup =
          failure instanceof ResourceCleanupError
            ? failure
            : new ResourceCleanupError({ failures: [failure] });
        this.#ledger.retainFailure(entry, cleanup);
        failure = cleanup;
      } else {
        this.#ledger.entries.delete(entry);
        entry.dependencies.clear();
        const slots = this.#slots.get(entry.token);
        if (slots?.get(entry.prepared.key) === entry) slots.delete(entry.prepared.key);
      }
      if (failure instanceof ResourceError) throw failure;
      if (this.#controller.signal.aborted) {
        throw new ResourceError(
          'RESOURCE_OPERATION_ABORTED',
          'Resource initialization was cancelled.',
          { cause: failure }
        );
      }
      throw new ResourceError('RESOURCE_INITIALIZATION_FAILED', 'Resource initialization failed.', {
        cause: failure,
      });
    }
  }

  #checkInitialization(): void {
    if (this.#controller.signal.aborted) throw aborted();
  }

  #assertAdmission(): void {
    if (this.#state === 'open') return;
    const code =
      this.#state === 'fenced'
        ? 'RESOURCE_SCOPE_FENCED'
        : this.#state === 'closing'
          ? 'RESOURCE_SCOPE_CLOSING'
          : 'RESOURCE_SCOPE_CLOSED';
    throw new ResourceError(code, 'The resource scope does not accept requests.');
  }

  #fence(error: ResourceCleanupError): void {
    if (this.#state === 'open') this.#state = 'fenced';
    this.#controller.abort(error);
  }

  close(options: ResourceCloseOptions = {}): Promise<void> {
    try {
      assertWiringRecord(options, ['mode']);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new ResourceError(
              'RESOURCE_BLUEPRINT_INVALID',
              'The resource close options are invalid.',
              { cause: error }
            )
      );
    }
    if (options.mode !== undefined && options.mode !== 'drain' && options.mode !== 'abort')
      return Promise.reject(
        new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'The resource close mode is invalid.')
      );
    if (options.mode === 'abort') this.#controller.abort(aborted());
    if (this.#closing !== undefined) return this.#closing;
    this.#state = 'closing';
    this.#closing = this.#finishClose();
    return this.#closing;
  }

  async #finishClose(): Promise<void> {
    try {
      // An admitted initializer may create its declared dependencies during drain.
      while (this.#pending.size !== 0) await Promise.allSettled([...this.#pending]);
      await this.#ledger.close();
      this.#state = 'closed';
    } catch (error) {
      this.#state = 'close-failed';
      throw error;
    } finally {
      // The ledger, not the ready cache, retains unresolved acquisitions after failed close.
      this.#slots.clear();
      this.#bindings.clear();
    }
  }
}

const scopes = new WeakMap<
  ResourceScope,
  { readonly blueprint: ResourceBlueprint; readonly scope: Scope }
>();

export function createResourceScope(
  ...input: [blueprint: ResourceBlueprint, options?: ResourceScopeOptions]
): ResourceScope {
  if (input.length < 1 || input.length > 2)
    throw new ResourceError(
      'RESOURCE_BLUEPRINT_INVALID',
      'A compiled Blueprint and optional external bindings are required.'
    );
  const [blueprint, options = {}] = input;
  assertWiringRecord(options, ['bindings']);
  const scope = new Scope(blueprint, options);
  Object.freeze(scope);
  scopes.set(scope, { blueprint, scope });
  return scope;
}

/** Profile factories may borrow a complete live Scope, never a partial ready table. */
export function bindResourceScope(
  blueprint: ResourceBlueprint,
  scope: ResourceScope
): ResourceRegistry {
  const owned = scopes.get(scope);
  if (owned === undefined || owned.blueprint !== blueprint)
    throw new ResourceError(
      'RESOURCE_SCOPE_MISMATCH',
      'The Scope does not belong to this Blueprint.'
    );
  owned.scope.assertReusable();
  return owned.scope.registry;
}
