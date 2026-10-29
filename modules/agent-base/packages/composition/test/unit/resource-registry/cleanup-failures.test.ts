import {
  compileResourceBlueprint,
  createResourceScope,
  defineResourceProvider,
  resourceDependency,
  ResourceCleanupError,
  ResourceError,
  type ResourceAcquisition,
} from '@ta-agent/base-composition/resource-registry';
import { describe, expect, it, vi } from 'vitest';
import { description, Handle, handleToken } from './fixtures.js';

function graph(
  worker: () => ResourceAcquisition<Handle> | Promise<ResourceAcquisition<Handle>>,
  validate?: () => void
) {
  const client = handleToken('client');
  const store = handleToken('store');
  const workerToken = handleToken('worker');
  const independent = handleToken('independent');
  const clientRelease = vi.fn();
  const storeRelease = vi.fn();
  const independentRelease = vi.fn();
  const scope = createResourceScope(
    compileResourceBlueprint([
      defineResourceProvider({
        token: client,
        dependencies: {},
        describe: description,
        create: () => ({ value: new Handle('client'), release: clientRelease }),
      }),
      defineResourceProvider({
        token: store,
        dependencies: { client: resourceDependency(client, (id: string) => id) },
        describe: description,
        create: () => ({ value: new Handle('store'), release: storeRelease }),
      }),
      defineResourceProvider({
        token: workerToken,
        dependencies: { store: resourceDependency(store, (id: string) => id) },
        describe: description,
        create: worker,
        ...(validate === undefined ? {} : { validate }),
      }),
      defineResourceProvider({
        token: independent,
        dependencies: {},
        describe: description,
        create: () => ({ value: new Handle('independent'), release: independentRelease }),
      }),
    ])
  );
  return {
    scope,
    client,
    store,
    workerToken,
    independent,
    clientRelease,
    storeRelease,
    independentRelease,
  };
}

describe('cleanup failure dependency protection', () => {
  it('protects transitive dependencies when create and unwind both fail before acquisition exists', async () => {
    const primary = new Error('Worker initialization failed');
    const unwind = new Error('Worker may still be accessing store');
    const failure = new ResourceCleanupError({ primary, failures: [unwind] });
    const test = graph(() => {
      throw failure;
    });
    await test.scope.registry.resolve(test.independent.request('key'));
    await expect(test.scope.registry.resolve(test.workerToken.request('key'))).rejects.toBe(
      failure
    );
    expect(test.scope.state).toBe('fenced');
    await expect(test.scope.registry.lookup(test.store.request('key'))).rejects.toMatchObject({
      code: 'RESOURCE_SCOPE_FENCED',
    });
    await expect(test.scope.close()).rejects.toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      failures: [failure],
      blocked: ['store', 'client'],
    });
    expect(test.storeRelease).not.toHaveBeenCalled();
    expect(test.clientRelease).not.toHaveBeenCalled();
    expect(test.independentRelease).toHaveBeenCalledOnce();
    await expect(test.scope.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
    expect(test.independentRelease).toHaveBeenCalledOnce();
  });

  it('protects dependencies after post-validation release fails even though value was never ready', async () => {
    const primary = new Error('Evidence rejected');
    const cleanup = new Error('Release failed');
    const release = vi.fn(() => {
      throw cleanup;
    });
    const test = graph(
      () => ({ value: new Handle('candidate'), release }),
      () => {
        throw primary;
      }
    );
    await test.scope.registry.resolve(test.independent.request('key'));
    await expect(
      test.scope.registry.resolve(test.workerToken.request('key'))
    ).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED', primary, failures: [cleanup] });
    await expect(test.scope.close()).rejects.toMatchObject({ blocked: ['store', 'client'] });
    expect(release).toHaveBeenCalledOnce();
    expect(test.storeRelease).not.toHaveBeenCalled();
    expect(test.clientRelease).not.toHaveBeenCalled();
    expect(test.independentRelease).toHaveBeenCalledOnce();
  });

  it('protects dependencies after a ready dependent fails release and keeps all independent outcomes', async () => {
    const release = vi.fn(() => Promise.reject(new Error('Ready worker release failed')));
    const test = graph(() => ({ value: new Handle('ready'), release }));
    await test.scope.registry.resolve(test.workerToken.request('key'));
    await test.scope.registry.resolve(test.independent.request('key'));
    const closing = test.scope.close();
    await expect(closing).rejects.toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      blocked: ['store', 'client'],
    });
    expect(test.scope.state).toBe('close-failed');
    expect(test.scope.close({ mode: 'abort' })).toBe(closing);
    expect(release).toHaveBeenCalledOnce();
    expect(test.independentRelease).toHaveBeenCalledOnce();
    expect(test.storeRelease).not.toHaveBeenCalled();
    expect(test.clientRelease).not.toHaveBeenCalled();
  });

  it('retains cleanup failure after every waiter has left, without unhandled initialization rejection', async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const failure = new ResourceCleanupError({
      failures: [new Error('Partial worker could not stop')],
    });
    const test = graph(async () => {
      started.resolve();
      await gate.promise;
      throw failure;
    });
    const controller = new AbortController();
    const request = test.scope.registry.resolve(test.workerToken.request('key'), {
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'RESOURCE_OPERATION_ABORTED' });
    const close = test.scope.close();
    const rejected = expect(close).rejects.toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      blocked: ['store', 'client'],
    });
    gate.resolve();
    await rejected;
    expect(test.storeRelease).not.toHaveBeenCalled();
    expect(test.clientRelease).not.toHaveBeenCalled();
  });

  it('retains cancellation plus failed unwind of a newly acquired candidate', async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const release = vi.fn(() => {
      throw new Error('Cancellation release failed');
    });
    const test = graph(async () => {
      started.resolve();
      await gate.promise;
      return { value: new Handle('late'), release };
    });
    const request = test.scope.registry.resolve(test.workerToken.request('key'));
    const rejected = expect(request).rejects.toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      primary: { code: 'RESOURCE_OPERATION_ABORTED' },
    });
    await started.promise;
    const close = test.scope.close({ mode: 'abort' });
    const failedClose = expect(close).rejects.toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      blocked: ['store', 'client'],
    });
    gate.resolve();
    await rejected;
    await failedClose;
    expect(release).toHaveBeenCalledOnce();
    expect(test.storeRelease).not.toHaveBeenCalled();
  });

  it('does not downgrade the public cleanup error code into a retryable initialization failure', async () => {
    const test = graph(() => {
      throw new ResourceError('RESOURCE_CLEANUP_FAILED', 'Unconfirmed unwind');
    });
    await expect(
      test.scope.registry.resolve(test.workerToken.request('key'))
    ).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
    await expect(test.scope.close()).rejects.toMatchObject({ blocked: ['store', 'client'] });
    expect(test.storeRelease).not.toHaveBeenCalled();
  });

  it('retains multiple independent cleanup failures without skipping protected dependencies', async () => {
    const test = graph(() => ({
      value: new Handle('worker'),
      release: () => {
        throw new Error('Worker release failed');
      },
    }));
    test.independentRelease.mockImplementation(() => {
      throw new Error('Independent release failed');
    });
    await test.scope.registry.resolve(test.workerToken.request('key'));
    await test.scope.registry.resolve(test.independent.request('key'));
    const error: unknown = await test.scope.close().then(
      () => {
        throw new Error('Expected cleanup failure');
      },
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ResourceCleanupError);
    if (!(error instanceof ResourceCleanupError))
      throw new Error('Expected structured cleanup failure');
    expect(error.failures).toHaveLength(2);
    expect(error.blocked).toEqual(['store', 'client']);
    expect(test.storeRelease).not.toHaveBeenCalled();
    expect(test.clientRelease).not.toHaveBeenCalled();
  });
});
