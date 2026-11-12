import {
  compileResourceBlueprint,
  createResourceScope,
  defineResourceProvider,
  resourceDependency,
} from '@print-an-agent/base-composition/resource-registry';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { description, Handle, handleToken } from './fixtures.js';

describe('Scope concurrency and cancellation', () => {
  it('lets a cancelled waiter leave before initialization finishes without cancelling siblings or pending lookup', async () => {
    const token = handleToken('shared');
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let initSignal: AbortSignal | undefined;
    const create = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      initSignal = signal;
      started.resolve();
      await gate.promise;
      return { value: new Handle('shared') };
    });
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({ token, dependencies: {}, describe: description, create }),
      ])
    );
    onTestFinished(async () => {
      gate.resolve();
      await scope.close();
    });
    const controller = new AbortController();
    const cancelled = scope.registry.resolve(token.request('key'), { signal: controller.signal });
    const sibling = scope.registry.resolve(token.request('key'));
    const lookup = scope.registry.lookup(token.request('key'));
    await started.promise;
    setTimeout(() => controller.abort(), 0);
    await expect(cancelled).rejects.toMatchObject({ code: 'RESOURCE_OPERATION_ABORTED' });
    expect(initSignal?.aborted).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    gate.resolve();
    expect(await lookup).toBe(await sibling);
  });

  it('does not abandon initialization when every waiter cancels and close still joins it', async () => {
    const token = handleToken('pending');
    const gate = Promise.withResolvers<void>();
    const release = vi.fn();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: async () => {
            await gate.promise;
            return { value: new Handle('pending'), release };
          },
        }),
      ])
    );
    onTestFinished(async () => {
      gate.resolve();
      await scope.close();
    });
    const controller = new AbortController();
    const request = scope.registry.resolve(token.request('key'), { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'RESOURCE_OPERATION_ABORTED' });
    let closed = false;
    const close = scope.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(release).not.toHaveBeenCalled();
    gate.resolve();
    await close;
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects delivery once close wins and drains admitted dependencies', async () => {
    const a = handleToken('a');
    const b = handleToken('b');
    const c = handleToken('c');
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const acquired: string[] = [];
    const released: string[] = [];
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token: b,
          dependencies: {},
          describe: description,
          create: async () => {
            acquired.push('b');
            started.resolve();
            await gate.promise;
            return {
              value: new Handle('b'),
              release: () => {
                released.push('b');
              },
            };
          },
        }),
        defineResourceProvider({
          token: c,
          dependencies: {},
          describe: description,
          create: () => {
            acquired.push('c');
            return {
              value: new Handle('c'),
              release: () => {
                released.push('c');
              },
            };
          },
        }),
        defineResourceProvider({
          token: a,
          dependencies: {
            b: resourceDependency(b, (id: string) => id),
            c: resourceDependency(c, (id: string) => id),
          },
          describe: description,
          create: () => {
            acquired.push('a');
            return {
              value: new Handle('a'),
              release: () => {
                released.push('a');
              },
            };
          },
        }),
      ])
    );
    onTestFinished(async () => {
      gate.resolve();
      await scope.close();
    });
    const request = scope.registry.resolve(a.request('key'));
    const rejected = expect(request).rejects.toMatchObject({ code: 'RESOURCE_SCOPE_CLOSING' });
    await started.promise;
    const close = scope.close();
    await expect(scope.registry.resolve(c.request('new-root'))).rejects.toMatchObject({
      code: 'RESOURCE_SCOPE_CLOSING',
    });
    gate.resolve();
    await rejected;
    await close;
    expect(acquired).toEqual(['b', 'c', 'a']);
    expect(released[0]).toBe('a');
    expect(released).toHaveLength(3);
  });

  it('escalates drain to abort, waits for real unwind, and reuses the same close result', async () => {
    const token = handleToken('blocked');
    const started = Promise.withResolvers<void>();
    const unwind = Promise.withResolvers<void>();
    let initSignal: AbortSignal | undefined;
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: async ({ signal }) => {
            initSignal = signal;
            started.resolve();
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true })
            );
            await unwind.promise;
            throw new Error('Initialization cancelled and unwound');
          },
        }),
      ])
    );
    onTestFinished(async () => {
      unwind.resolve();
      await scope.close({ mode: 'abort' });
    });
    const request = scope.registry.resolve(token.request('key'));
    const rejected = expect(request).rejects.toMatchObject({
      code: 'RESOURCE_OPERATION_ABORTED',
      cause: { message: 'Initialization cancelled and unwound' },
    });
    await started.promise;
    const first = scope.close();
    expect(initSignal?.aborted).toBe(false);
    expect(scope.close({ mode: 'abort' })).toBe(first);
    expect(initSignal?.aborted).toBe(true);
    expect(scope.state).toBe('closing');
    unwind.resolve();
    await rejected;
    await first;
    expect(scope.state).toBe('closed');
    expect(scope.close()).toBe(first);
  });

  it('does not pretend an uncooperative initializer has stopped after abort', async () => {
    const token = handleToken('uncooperative');
    const gate = Promise.withResolvers<void>();
    const release = vi.fn();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: async () => {
            await gate.promise;
            return { value: new Handle('late'), release };
          },
        }),
      ])
    );
    onTestFinished(async () => {
      gate.resolve();
      await scope.close({ mode: 'abort' });
    });
    const request = scope.registry.resolve(token.request('key'));
    const rejected = expect(request).rejects.toMatchObject({ code: 'RESOURCE_OPERATION_ABORTED' });
    let done = false;
    const close = scope.close({ mode: 'abort' }).then(() => {
      done = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(done).toBe(false);
    expect(release).not.toHaveBeenCalled();
    gate.resolve();
    await rejected;
    await close;
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects an already cancelled admission without starting a factory', async () => {
    const token = handleToken('cancelled');
    const create = vi.fn(() => ({ value: new Handle('never') }));
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({ token, dependencies: {}, describe: description, create }),
      ])
    );
    onTestFinished(() => scope.close());
    const signal = AbortSignal.abort();
    await expect(scope.registry.resolve(token.request('key'), { signal })).rejects.toMatchObject({
      code: 'RESOURCE_OPERATION_ABORTED',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('captures the admitted signal rather than rereading mutable options after waiting', async () => {
    const token = handleToken('signal-snapshot');
    const gate = Promise.withResolvers<void>();
    const scope = createResourceScope(
      compileResourceBlueprint([
        defineResourceProvider({
          token,
          dependencies: {},
          describe: description,
          create: async () => {
            await gate.promise;
            return { value: new Handle('signal-snapshot') };
          },
        }),
      ])
    );
    onTestFinished(async () => {
      gate.resolve();
      await scope.close();
    });
    const options = { signal: new AbortController().signal };
    const request = scope.registry.resolve(token.request('key'), options);
    options.signal = AbortSignal.abort();
    gate.resolve();
    expect(await request).toBeInstanceOf(Handle);
  });
});
