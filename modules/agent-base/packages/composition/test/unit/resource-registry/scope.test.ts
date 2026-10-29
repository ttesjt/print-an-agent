import {
  compileResourceBlueprint,
  createResourceScope,
  defineResourceProvider,
  resourceDependency,
  ResourceToken,
} from '@ta-agent/base-composition/resource-registry';
import { describe, expect, it, vi } from 'vitest';
import { description, Handle, handleToken, expectResourceError } from './fixtures.js';

describe('Scoped resolution', () => {
  it('is lazy, reuses opaque identity, isolates scopes and does not fall back', async () => {
    const token = handleToken('same');
    const create = vi.fn(({ binding }: { binding: string }) => {
      const value = new Handle(binding);
      return { value, release: () => value.close() };
    });
    const blueprint = compileResourceBlueprint([
      defineResourceProvider({ token, dependencies: {}, describe: description, create }),
    ]);
    const scope = createResourceScope(blueprint);
    const other = createResourceScope(blueprint);
    expect(create).not.toHaveBeenCalled();
    expect(await scope.registry.lookup(token.request('one'))).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    const [one, same] = await Promise.all([
      scope.registry.resolve(token.request('one')),
      scope.registry.resolve(token.request('one')),
    ]);
    expect(one).toBe(same);
    expect(await scope.registry.lookup(token.request('one'))).toBe(one);
    expect(await other.registry.resolve(token.request('one'))).not.toBe(one);
    await expect(scope.registry.resolve(handleToken('same').request('one'))).rejects.toMatchObject({
      code: 'RESOURCE_NOT_DECLARED',
    });
    await Promise.all([scope.close(), other.close()]);
    expect(one.closed).toBe(true);
    await scope.close();
    await expect(scope.registry.lookup(token.request('one'))).rejects.toMatchObject({
      code: 'RESOURCE_SCOPE_CLOSED',
    });
  });

  it('shares dependencies and releases them after all dependents, preserving method receivers', async () => {
    const store = handleToken('store');
    const worker = handleToken('worker');
    const releases: string[] = [];
    const blueprint = compileResourceBlueprint([
      defineResourceProvider({
        token: store,
        dependencies: {},
        describe: description,
        create: ({ binding }) => {
          const acquisition = {
            value: new Handle(binding),
            release() {
              expect(this.value.id).toBe('shared');
              releases.push('store');
            },
          };
          return acquisition;
        },
      }),
      defineResourceProvider({
        token: worker,
        dependencies: { store: resourceDependency(store, (_binding: string) => 'shared') },
        describe: description,
        create: ({ binding, dependencies }) => ({
          value: new Handle(binding),
          release: () => {
            expect(dependencies.store.closed).toBe(false);
            releases.push(binding);
          },
        }),
      }),
    ]);
    const scope = createResourceScope(blueprint);
    await Promise.all(['a', 'b'].map((key) => scope.registry.resolve(worker.request(key))));
    expect(await scope.registry.lookup(store.request('shared'))).toBeInstanceOf(Handle);
    await scope.close();
    expect(releases).toHaveLength(3);
    expect(releases.at(-1)).toBe('store');
  });

  it('snapshots a mutable request before waiting and rejects descriptor collisions', async () => {
    const token = new ResourceToken('object', {
      parseBinding(input: unknown): { id: string; revision: number } {
        if (
          typeof input !== 'object' ||
          input === null ||
          !('id' in input) ||
          typeof input.id !== 'string' ||
          !('revision' in input) ||
          typeof input.revision !== 'number'
        )
          throw new Error('Invalid test binding');
        return { id: input.id, revision: input.revision };
      },
      isValue: (value): value is Handle => value instanceof Handle,
    });
    const gate = Promise.withResolvers<void>();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: (binding) => ({ key: binding.id, descriptor: binding }),
          create: async ({ binding }) => {
            await gate.promise;
            return { value: new Handle(binding.id) };
          },
        }),
      ])
    );
    const request = { token, binding: { id: 'first', revision: 1 } };
    const result = scope.registry.resolve(request);
    request.binding.id = 'second';
    gate.resolve();
    expect((await result).id).toBe('first');
    await expect(
      scope.registry.resolve(token.request({ id: 'first', revision: 2 }))
    ).rejects.toMatchObject({ code: 'RESOURCE_BINDING_CONFLICT' });
    await scope.close();
  });

  it('retries only explicit ordinary failures, retaining healthy shared dependencies', async () => {
    const store = handleToken('store');
    const worker = handleToken('worker');
    const value = new Handle('store');
    let attempts = 0;
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token: store,
          dependencies: {},
          describe: description,
          create: () => ({ value, release: () => value.close() }),
        }),
        defineResourceProvider({
          token: worker,
          dependencies: { store: resourceDependency(store, (binding: string) => binding) },
          describe: description,
          create: () => {
            if (++attempts === 1) throw new Error('Ordinary init failure');
            return { value: new Handle('worker') };
          },
        }),
      ])
    );
    await expect(scope.registry.resolve(worker.request('key'))).rejects.toMatchObject({
      code: 'RESOURCE_INITIALIZATION_FAILED',
    });
    expect(value.closed).toBe(false);
    expect(await scope.registry.resolve(worker.request('key'))).toBeInstanceOf(Handle);
    expect(attempts).toBe(2);
    await scope.close();
    expect(value.closed).toBe(true);
  });

  it('releases rejected acquisitions exactly once, without publishing them', async () => {
    const token = handleToken('invalid');
    const release = vi.fn();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: () => ({ value: new Handle('candidate'), release }),
          validate: () => {
            throw new Error('Rejected evidence');
          },
        }),
      ])
    );
    await expect(scope.registry.resolve(token.request('key'))).rejects.toMatchObject({
      code: 'RESOURCE_INITIALIZATION_FAILED',
    });
    expect(await scope.registry.lookup(token.request('key'))).toBeUndefined();
    await scope.close();
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not infer ownership from a close method when no release was declared', async () => {
    const token = handleToken('pure-capability');
    const value = new Handle('not-an-owned-lease');
    const close = vi.spyOn(value, 'close');
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: () => ({ value }),
        }),
      ])
    );
    await scope.registry.resolve(token.request('key'));
    await scope.close();
    expect(close).not.toHaveBeenCalled();
  });

  it('registers ownership before a returned value getter can reject validation', async () => {
    const token = handleToken('getter');
    const release = vi.fn();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: () => ({
            get value(): Handle {
              throw new Error('Invalid returned value');
            },
            release,
          }),
        }),
      ])
    );
    await expect(scope.registry.resolve(token.request('key'))).rejects.toMatchObject({
      code: 'RESOURCE_INITIALIZATION_FAILED',
    });
    await scope.close();
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not implicitly execute thenable capabilities or malformed thenable acquisitions', async () => {
    const token = handleToken('thenable');
    const then = vi.fn();
    const release = vi.fn();
    class ThenableHandle extends Handle {
      then = then;
    }
    const acquisitionThen = vi.fn();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: ({ binding }) =>
            binding === 'value'
              ? { value: new ThenableHandle('thenable'), release }
              : { value: new Handle('regular'), then: acquisitionThen, release },
        }),
      ])
    );
    await expect(scope.registry.resolve(token.request('value'))).rejects.toMatchObject({
      code: 'RESOURCE_INITIALIZATION_FAILED',
    });
    await expect(scope.registry.resolve(token.request('acquisition'))).rejects.toMatchObject({
      code: 'RESOURCE_INITIALIZATION_FAILED',
    });
    await scope.close();
    expect(then).not.toHaveBeenCalled();
    expect(acquisitionThen).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce distinct numeric binding identities through JSON negative zero rounding', async () => {
    const token = new ResourceToken('numeric', {
      parseBinding: (input: unknown) => Number(input),
      isValue: (value): value is Handle => value instanceof Handle,
    });
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: (value) => ({ key: 'constant', descriptor: value }),
          create: () => ({ value: new Handle('numeric') }),
        }),
      ])
    );
    await scope.registry.resolve(token.request(-0));
    await expect(scope.registry.resolve(token.request(0))).rejects.toMatchObject({
      code: 'RESOURCE_BINDING_CONFLICT',
    });
    await scope.close();
  });

  it('captures the release callback and validated value without freezing the returned resource', async () => {
    const token = handleToken('stable-ownership');
    const release = vi.fn();
    const replacement = vi.fn();
    const original = new Handle('original');
    const changed = new Handle('changed');
    let reads = 0;
    const acquisition = {
      get value() {
        return reads++ === 0 ? original : changed;
      },
      release,
    };
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: () => acquisition,
        }),
      ])
    );
    expect(await scope.registry.resolve(token.request('key'))).toBe(original);
    acquisition.release = replacement;
    await scope.close();
    expect(reads).toBe(1);
    expect(release).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
    expect(Object.isFrozen(original)).toBe(false);
  });

  it('rejects accidental async validation, but joins it before releasing the acquisition', async () => {
    const token = handleToken('async-validation');
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const release = vi.fn();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: () => ({ value: new Handle('candidate'), release }),
          // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Intentionally exercise void/async assignability at the public boundary.
          validate: async () => {
            started.resolve();
            await gate.promise;
          },
        }),
      ])
    );
    const request = scope.registry.resolve(token.request('key'));
    const rejected = expect(request).rejects.toMatchObject({
      code: 'RESOURCE_INITIALIZATION_FAILED',
    });
    await started.promise;
    const closing = scope.close({ mode: 'abort' });
    expect(release).not.toHaveBeenCalled();
    gate.resolve();
    await rejected;
    await closing;
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps description failures private in the default error message', async () => {
    const token = handleToken('safe-diagnostics');
    const cause = new Error('Sensitive binding details');
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: () => {
            throw cause;
          },
          create: () => ({ value: new Handle('unused') }),
        }),
      ])
    );
    await expect(scope.registry.resolve(token.request('secret'))).rejects.toMatchObject({
      code: 'RESOURCE_BINDING_CONFLICT',
      message: 'A resource binding could not be described.',
      cause,
    });
    await scope.close();
  });

  it('rejects unsupported Scope options rather than silently creating the wrong resources', () => {
    const blueprint = compileResourceBlueprint([]);
    expectResourceError(() => {
      // @ts-expect-error Providers cannot be overridden at Scope creation.
      return createResourceScope(blueprint, { providers: [] });
    }, 'RESOURCE_BLUEPRINT_INVALID');
  });

  it('awaits genuine factory Promises even when they carry unrelated release metadata', async () => {
    const token = handleToken('augmented-promise');
    const creation = Promise.withResolvers<{ value: Handle; release: () => void }>();
    const unrelatedRelease = vi.fn();
    const release = vi.fn();
    const produced = Object.assign(creation.promise, { release: unrelatedRelease });
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: () => produced,
        }),
      ])
    );
    const request = scope.registry.resolve(token.request('key'));
    const value = new Handle('resolved');
    creation.resolve({ value, release });
    expect(await request).toBe(value);
    await scope.close();
    expect(release).toHaveBeenCalledOnce();
    expect(unrelatedRelease).not.toHaveBeenCalled();
  });
});
