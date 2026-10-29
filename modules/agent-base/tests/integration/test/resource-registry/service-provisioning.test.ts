import { describe, expect, it } from 'vitest';
import { createDocumentProfile } from './examples/service-provisioning/profile.js';
import {
  createDocumentManagementService,
  createDocumentTitleService,
} from './examples/service-provisioning/service.js';
import { createDocumentBundle } from './examples/service-provisioning/workflow.js';

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const tenantBindings = new Map([
  ['a', 'authority:a'],
  ['b', 'authority:b'],
]);

describe('Service responsibilities and on-demand provisioning', () => {
  it('shares a Bundle through Profile Service while keeping application Services and Runs independent', async () => {
    const events: string[] = [];
    const bindings = new Map(tenantBindings);
    const profile = createDocumentProfile({
      tenantBindings: bindings,
      acquireStore: (tenant) => {
        events.push(`create:${tenant}`);
        let open = true;
        return {
          value: {
            read: (id, signal) => {
              signal.throwIfAborted();
              if (!open) throw new Error('Store closed.');
              return Promise.resolve(`${tenant}:${id}\nbody`);
            },
          },
          release: () => {
            open = false;
            events.push(`close:${tenant}`);
          },
        };
      },
      releaseReader: async (store) => {
        await store.read('release', new AbortController().signal);
        events.push('release:reader');
      },
    });
    const first = createDocumentManagementService(profile.definition);
    const second = createDocumentManagementService(profile.definition);
    const titles = createDocumentTitleService(first);
    // Later external edits cannot introduce a target or silently replace the Profile's authority.
    bindings.set('a', 'changed-authority');
    bindings.set('unknown', 'injected-authority');
    try {
      expect(events).toEqual([]);
      await expect(first.read({ tenant: '', documentId: 'intro' })).rejects.toThrow('required');
      await expect(first.read({ tenant: 'unknown', documentId: 'intro' })).rejects.toThrow(
        'Unknown tenant'
      );
      expect(events).toEqual([]);
      const target = { tenant: 'a', documentId: 'intro' };
      const results = await Promise.all([first.read(target), second.read(target)]);
      expect(events).toEqual(['create:authority:a']);
      expect(results.map((result) => result.reads)).toEqual([1, 1]);
      expect(results[0]?.runId).not.toBe(results[1]?.runId);
      expect(await profile.resources.resolveReader('a')).toBe(
        await profile.definition.documents.resolveReader('a')
      );
      await expect(titles.title(target)).resolves.toBe('authority:a:intro');
      await expect(second.read({ ...target, tenant: 'b' })).resolves.toMatchObject({
        text: 'authority:b:intro\nbody',
      });
    } finally {
      await profile.close();
    }
    expect(events.filter((event) => event === 'release:reader')).toHaveLength(2);
    expect(events.indexOf('release:reader')).toBeLessThan(events.indexOf('close:authority:a'));
    expect('close' in profile.resources).toBe(false);
    expect('close' in first).toBe(false);
    await expect(first.read({ tenant: 'a', documentId: 'intro' })).rejects.toMatchObject({
      code: 'RESOURCE_SCOPE_CLOSED',
    });
  });

  it('uses the same generic Service and neutral Workflow with a direct factory and no Registry', async () => {
    let resolved = 0;
    const bundle = createDocumentBundle({
      documents: { read: (id) => Promise.resolve(`direct:${id}`) },
    });
    const service = createDocumentManagementService({
      documents: {
        resolveReader: () => {
          resolved += 1;
          return Promise.resolve(bundle);
        },
      },
    });
    expect(resolved).toBe(0);
    await expect(service.read({ tenant: 'a', documentId: 'intro' })).resolves.toMatchObject({
      text: 'direct:intro',
    });
    expect(resolved).toBe(1);
  });

  it('cancels one resolver waiter without canceling Scope-owned shared initialization', async () => {
    const started = gate();
    const ready = gate();
    let created = 0;
    let released = 0;
    let initializationSignal: AbortSignal | undefined;
    const profile = createDocumentProfile({
      tenantBindings,
      acquireStore: async (_tenant, signal) => {
        created += 1;
        initializationSignal = signal;
        started.release();
        await ready.promise;
        return {
          value: { read: () => Promise.resolve('ready') },
          release: () => {
            released += 1;
          },
        };
      },
    });
    const service = createDocumentManagementService(profile.definition);
    const controller = new AbortController();
    const input = { tenant: 'a', documentId: 'intro' };
    const canceled = service.read(input, { signal: controller.signal });
    const rejected = expect(canceled).rejects.toBeDefined();
    const continuing = service.read(input);
    try {
      await started.promise;
      controller.abort();
      await rejected;
      expect(initializationSignal?.aborted).toBe(false);
      expect(released).toBe(0);
      ready.release();
      await expect(continuing).resolves.toMatchObject({ text: 'ready', reads: 1 });
      expect(created).toBe(1);
    } finally {
      ready.release();
      await Promise.allSettled([canceled, continuing]);
      await profile.close();
    }
    expect(released).toBe(1);
  });

  it('keeps active Run cancellation separate from shared resources and joins work before Host close', async () => {
    const entered = gate();
    const finish = gate();
    let active = 0;
    let released = false;
    const profile = createDocumentProfile({
      tenantBindings,
      acquireStore: () => ({
        value: {
          read: async (_id, signal) => {
            active += 1;
            entered.release();
            try {
              await finish.promise;
              signal.throwIfAborted();
              return 'done';
            } finally {
              active -= 1;
            }
          },
        },
        release: () => {
          expect(active).toBe(0);
          released = true;
        },
      }),
    });
    const service = createDocumentManagementService(profile.definition);
    const controller = new AbortController();
    const input = { tenant: 'a', documentId: 'intro' };
    const canceled = service.read(input, { signal: controller.signal });
    const rejected = expect(canceled).rejects.toBeDefined();
    const continuing = service.read(input);
    try {
      await entered.promise;
      controller.abort();
      expect(released).toBe(false);
      finish.release();
      await rejected;
      await expect(continuing).resolves.toMatchObject({ text: 'done', reads: 1 });
    } finally {
      finish.release();
      // The Host joins actual business calls, not just the Registry resolution waiters.
      await Promise.allSettled([canceled, continuing]);
      await profile.close();
    }
    expect(released).toBe(true);
  });

  it('protects a retained dependency when dependent release is unconfirmed, without retrying cleanup', async () => {
    // In-memory capabilities only: the deliberately failed cleanup leaves no OS handle or worker.
    let storeReleases = 0;
    let readerReleases = 0;
    const failure = new Error('Reader cleanup is unconfirmed.');
    const profile = createDocumentProfile({
      tenantBindings,
      acquireStore: () => ({
        value: { read: () => Promise.resolve('available during release') },
        release: () => {
          storeReleases += 1;
        },
      }),
      releaseReader: async (store) => {
        readerReleases += 1;
        await expect(store.read('release', new AbortController().signal)).resolves.toBe(
          'available during release'
        );
        throw failure;
      },
    });
    const service = createDocumentManagementService(profile.definition);
    await service.read({ tenant: 'a', documentId: 'intro' });
    await expect(profile.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
    await expect(profile.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
    expect(readerReleases).toBe(1);
    expect(storeReleases).toBe(0);
  });
});
