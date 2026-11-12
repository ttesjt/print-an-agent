import {
  bindResourceScope,
  borrowResource,
  compileResourceBlueprint,
  createResourceScope,
  defineResourceProvider,
  resourceDependency,
  ResourceCleanupError,
  ResourceToken,
  type ResourceScope,
} from '@print-an-agent/base-composition/resource-registry';
import { describe, expect, it, vi } from 'vitest';
import { description, Handle, handleToken, expectResourceError } from './fixtures.js';

function root() {
  const token = handleToken('root');
  const create = vi.fn(({ binding }: { binding: string }) => ({ value: new Handle(binding) }));
  const validate = vi.fn((value: Handle, binding: string) => {
    if (value.id !== binding) throw new Error('Authority mismatch');
  });
  const provider = defineResourceProvider({
    token,
    describe: description,
    dependencies: {},
    create,
    validate,
    externalBinding: 'borrowed',
  });
  return { token, create, validate, provider, blueprint: compileResourceBlueprint([provider]) };
}

describe('closed borrowed binding declarations', () => {
  it('is lazy, snapshots wiring, shares lookup/resolve and never takes ownership', async () => {
    const test = root();
    const value = new Handle('space');
    const close = vi.spyOn(value, 'close');
    const request = { token: test.token, binding: 'space' };
    const bindings = [borrowResource(request, value)];
    const scope = createResourceScope(test.blueprint, { bindings });
    request.binding = 'changed';
    bindings.length = 0;
    expect(test.validate).not.toHaveBeenCalled();
    expect(Object.isFrozen(value)).toBe(false);
    const [one, two] = await Promise.all([
      scope.registry.lookup(test.token.request('space')),
      scope.registry.resolve(test.token.request('space')),
    ]);
    expect(one).toBe(value);
    expect(two).toBe(value);
    expect(test.validate).toHaveBeenCalledOnce();
    expect(test.create).not.toHaveBeenCalled();
    await scope.close();
    expect(close).not.toHaveBeenCalled();
    value.close();
  });

  it('does not validate unused values, invoke fallback or release a rejected borrowed value', async () => {
    const test = root();
    const value = new Handle('wrong-authority');
    const close = vi.spyOn(value, 'close');
    const scope = createResourceScope(test.blueprint, {
      bindings: [borrowResource(test.token.request('space'), value)],
    });
    await expect(scope.registry.lookup(test.token.request('space'))).rejects.toMatchObject({
      code: 'RESOURCE_EXTERNAL_BINDING_INVALID',
    });
    expect(test.create).not.toHaveBeenCalled();
    await scope.close();
    expect(close).not.toHaveBeenCalled();
    const unused = createResourceScope(test.blueprint, {
      bindings: [borrowResource(test.token.request('space'), value)],
    });
    test.validate.mockClear();
    await unused.close();
    expect(test.validate).not.toHaveBeenCalled();
  });

  it('rejects undeclared, forbidden and dependent overrides before any factory runs', () => {
    const test = root();
    const borrowed = borrowResource(test.token.request('space'), new Handle('space'));
    expectResourceError(
      () => createResourceScope(compileResourceBlueprint([]), { bindings: [borrowed] }),
      'RESOURCE_EXTERNAL_BINDING_INVALID'
    );
    const forbidden = defineResourceProvider({
      token: test.token,
      describe: description,
      dependencies: {},
      create: test.create,
    });
    expectResourceError(
      () => createResourceScope(compileResourceBlueprint([forbidden]), { bindings: [borrowed] }),
      'RESOURCE_EXTERNAL_BINDING_INVALID'
    );
    const dependent = handleToken('dependent');
    const provider = defineResourceProvider({
      token: dependent,
      describe: description,
      dependencies: { root: resourceDependency(test.token, (key: string) => key) },
      create: test.create,
      externalBinding: 'borrowed',
    });
    expectResourceError(
      () =>
        createResourceScope(compileResourceBlueprint([test.provider, provider]), {
          bindings: [borrowResource(dependent.request('space'), new Handle('space'))],
        }),
      'RESOURCE_EXTERNAL_BINDING_INVALID'
    );
    expect(test.create).not.toHaveBeenCalled();
  });

  it('rejects duplicates, malformed declarations and getter lists without executing getters', () => {
    const test = root();
    const value = borrowResource(test.token.request('space'), new Handle('space'));
    expectResourceError(
      () => createResourceScope(test.blueprint, { bindings: [value, value] }),
      'RESOURCE_EXTERNAL_BINDING_INVALID'
    );
    for (const bindings of [[{}], [undefined], new Array(1), null]) {
      expectResourceError(() => {
        Reflect.apply(createResourceScope, undefined, [test.blueprint, { bindings }]);
      }, 'RESOURCE_EXTERNAL_BINDING_INVALID');
    }
    const getter = vi.fn(() => value);
    const list = [value];
    Object.defineProperty(list, '0', { get: getter });
    expect(() => createResourceScope(test.blueprint, { bindings: list })).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects descriptor collisions on registration and on lookup, without losing scope authority', async () => {
    const token = new ResourceToken('versioned', {
      parseBinding(input: unknown): { id: string; revision: number } {
        if (
          input === null ||
          typeof input !== 'object' ||
          !('id' in input) ||
          typeof input.id !== 'string' ||
          !('revision' in input) ||
          typeof input.revision !== 'number'
        )
          throw new Error('Invalid binding');
        return { id: input.id, revision: input.revision };
      },
      isValue: (value): value is Handle => value instanceof Handle,
    });
    const create = vi.fn(() => ({ value: new Handle('fallback') }));
    const blueprint = compileResourceBlueprint([
      defineResourceProvider({
        token,
        describe: (binding) => ({ key: binding.id, descriptor: binding }),
        dependencies: {},
        create,
        externalBinding: 'borrowed',
      }),
    ]);
    const first = borrowResource(token.request({ id: 's', revision: 1 }), new Handle('s'));
    const second = borrowResource(token.request({ id: 's', revision: 2 }), new Handle('s'));
    expectResourceError(
      () => createResourceScope(blueprint, { bindings: [first, second] }),
      'RESOURCE_BINDING_CONFLICT'
    );
    const scope = createResourceScope(blueprint, { bindings: [first] });
    await expect(
      scope.registry.lookup(token.request({ id: 's', revision: 2 }))
    ).rejects.toMatchObject({ code: 'RESOURCE_BINDING_CONFLICT' });
    expect(await scope.registry.resolve(token.request({ id: 's', revision: 1 }))).toBeInstanceOf(
      Handle
    );
    expect(create).not.toHaveBeenCalled();
    await scope.close();
  });
});

describe('Host keeps the entire scoped graph', () => {
  it('refuses new bindings while closing or fenced, including failed initialization before acquisition', async () => {
    const token = handleToken('owned');
    const released = Promise.withResolvers<void>();
    const blueprint = compileResourceBlueprint([
      defineResourceProvider({
        token,
        dependencies: {},
        describe: description,
        create: () => ({ value: new Handle('space'), release: () => released.promise }),
      }),
    ]);
    const scope = createResourceScope(blueprint);
    await scope.registry.resolve(token.request('space'));
    const closing = scope.close();
    expectResourceError(() => bindResourceScope(blueprint, scope), 'RESOURCE_SCOPE_CLOSING');
    released.resolve();
    await closing;

    const failedBlueprint = compileResourceBlueprint([
      defineResourceProvider({
        token,
        dependencies: {},
        describe: description,
        create: () => {
          throw new ResourceCleanupError({ failures: [new Error('Unwind failed')] });
        },
      }),
    ]);
    const fenced = createResourceScope(failedBlueprint);
    await expect(fenced.registry.resolve(token.request('space'))).rejects.toBeInstanceOf(
      ResourceCleanupError
    );
    expectResourceError(() => bindResourceScope(failedBlueprint, fenced), 'RESOURCE_SCOPE_FENCED');
    await expect(fenced.close()).rejects.toBeInstanceOf(ResourceCleanupError);
  });

  it('binds multiple factories to one compiled Blueprint, not equal-looking recipes or forged scopes', async () => {
    const test = root();
    const scope = createResourceScope(test.blueprint);
    const definition = (owner: ResourceScope) => {
      const resources = bindResourceScope(test.blueprint, owner);
      return { open: () => resources.resolve(test.token.request('space')) };
    };
    const first = definition(scope);
    const second = definition(scope);
    expect(await first.open()).toBe(await second.open());
    expect(test.create).toHaveBeenCalledOnce();
    expectResourceError(
      () => bindResourceScope(compileResourceBlueprint([test.provider]), scope),
      'RESOURCE_SCOPE_MISMATCH'
    );
    expectResourceError(
      () =>
        bindResourceScope(test.blueprint, {
          registry: scope.registry,
          state: 'open',
          close: () => scope.close(),
        }),
      'RESOURCE_SCOPE_MISMATCH'
    );
    await scope.close();
    expectResourceError(() => definition(scope), 'RESOURCE_SCOPE_CLOSED');
    await expect(first.open()).rejects.toMatchObject({ code: 'RESOURCE_SCOPE_CLOSED' });
  });

  it('injects an explicit aggregate root with the same authority, but a reference cannot extend its external lease', async () => {
    class Store extends Handle {
      readonly rows: string[] = [];
      read() {
        if (this.closed) throw new Error('Lease closed');
        return this.rows;
      }
    }
    class Bundle {
      constructor(
        readonly authority: string,
        readonly read: () => readonly string[]
      ) {}
    }
    const store = new Store('space');
    const bundle = new Bundle('space', () => store.read());
    const storeToken = new ResourceToken('store', {
      parseBinding: (input: unknown) => String(input),
      isValue: (value): value is Store => value instanceof Store,
    });
    const bundleToken = new ResourceToken('aggregate', {
      parseBinding: (input: unknown) => String(input),
      isValue: (value): value is Bundle => value instanceof Bundle,
    });
    const blueprint = compileResourceBlueprint([
      defineResourceProvider({
        token: storeToken,
        dependencies: {},
        describe: description,
        create: () => ({ value: store }),
        externalBinding: 'borrowed',
        validate: (value, binding) => {
          if (value.id !== binding) throw new Error('Mismatch');
        },
      }),
      defineResourceProvider({
        token: bundleToken,
        dependencies: {},
        describe: description,
        create: () => ({ value: bundle }),
        externalBinding: 'borrowed',
        validate: (value, binding) => {
          if (value.authority !== binding) throw new Error('Mismatch');
        },
      }),
    ]);
    const scope = createResourceScope(blueprint, {
      bindings: [
        borrowResource(storeToken.request('space'), store),
        borrowResource(bundleToken.request('space'), bundle),
      ],
    });
    const management = await scope.registry.resolve(storeToken.request('space'));
    const runtime = await scope.registry.resolve(bundleToken.request('space'));
    management.rows.push('committed');
    expect(runtime.read()).toEqual(['committed']);
    store.close(); // Deliberately violate the external owner's lifetime obligation.
    expect(() => runtime.read()).toThrow('Lease closed');
    await scope.close(); // No ownership transfer, no double close.
  });

  it('requires Host business drain and does not close an external root after dependent cleanup fails', async () => {
    const test = root();
    const external = new Handle('space');
    const worker = handleToken('worker');
    const finish = Promise.withResolvers<void>();
    const release = vi.fn(() => {
      throw new Error('Worker still uses root');
    });
    const blueprint = compileResourceBlueprint([
      test.provider,
      defineResourceProvider({
        token: worker,
        describe: description,
        dependencies: { root: resourceDependency(test.token, (key: string) => key) },
        create: ({ dependencies }) => ({ value: dependencies.root, release }),
      }),
    ]);
    const scope = createResourceScope(blueprint, {
      bindings: [borrowResource(test.token.request('space'), external)],
    });
    const resource = await scope.registry.resolve(worker.request('space'));
    const operation = finish.promise.then(() => expect(resource.closed).toBe(false));
    expect(scope.state).toBe('open');
    finish.resolve();
    await operation; // Host, not Scope, joins the real business call before close.
    const failure = await scope.close().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResourceCleanupError);
    expect(failure).toMatchObject({ blocked: ['root'] });
    expect(external.closed).toBe(false);
    // Host must NOT close external here: failed dependent may still use it.
    expectResourceError(() => bindResourceScope(blueprint, scope), 'RESOURCE_SCOPE_CLOSED');
    expect(release).toHaveBeenCalledOnce();
  });
});
