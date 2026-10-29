import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  createAgentManagementService,
  createContextMemoryManagementService,
  defineManagedAgentComposition,
  MemoryManagementError,
  scopedAgentMemoryId,
  type MemoryManagementOptions,
} from '@ta-agent/base-composition';
import { createTokenCounter, TEXT_TOKEN_INPUT_CONTRACT } from '@ta-agent/model-invocation-core';
import {
  ContextMemoryError,
  createMemoryApplyDefinition,
  createMemoryGetReceiptDefinition,
  type MemoryStore,
  type MemoryWorkflowDefinitions,
} from '@ta-agent/context-memory';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';
import { parseAgentId } from '@ta-agent/base-identity';
import {
  createStandaloneMemorySetup,
  createStandaloneDirectorySetup,
  createSharedSqliteStandaloneSetup,
} from '../../src/index.js';
import { resourceProfileConfig } from '../support/resource-profile.js';
import { directContextMemory, directMemoryResources } from '../support/direct-context-memory.js';

const runtime = {
  readEnvironmentVariable: () => {
    throw new Error('Credentials must not be used');
  },
};
function counter(measure = (text: string, _signal: AbortSignal) => Promise.resolve(text.length)) {
  return createTokenCounter({
    measurementRef: 'chars',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: async (input, signal) => ({
      tokens: await measure(input.text, signal),
      accuracy: 'exact',
    }),
  });
}
async function direct(
  options: {
    readonly store?: (store: MemoryStore) => MemoryStore;
    readonly workflows?: Partial<MemoryWorkflowDefinitions>;
    readonly counter?: ReturnType<typeof counter>;
  } = {}
) {
  const setup = createStandaloneMemorySetup(runtime);
  const store = new SqliteMemoryStore({ path: ':memory:' });
  onTestFinished(async () => {
    await setup.close({ mode: 'abort' });
    store.close();
  });
  await createAgentManagementService(setup.definition).create({
    identity: { id: 'a' },
    config: resourceProfileConfig(),
  });
  const definition = directContextMemory(
    setup.definition.namespace.port,
    directMemoryResources(options.store?.(store) ?? store, options.counter ?? counter()),
    options.workflows
  );
  return { store, setup, definition, service: createContextMemoryManagementService(definition) };
}
const target = { agentId: 'a', memoryId: 'notes' };

it('preserves atomic commands, IDs, exact content, CAS, configurable budgets and explicit configure behavior', async () => {
  const { service } = await direct();
  const created = await service.create({
    ...target,
    requestId: 'create',
    items: [{ content: ' first\n' }, { content: '  ' }],
    config: { maxContextTokens: 30 },
  });
  expect(created).toMatchObject({
    target,
    value: { status: 'committed', receipt: { revision: 1 } },
  });
  const before = await service.inspect(target);
  expect(before.value?.items).toHaveLength(1);
  expect(before.value?.items[0]?.content).toBe(' first\n');
  const itemId = before.value!.items[0]!.id;
  expect(itemId).toBeTruthy();
  await expect(
    service.apply({
      ...target,
      requestId: 'invalid',
      expectedRevision: 1,
      commands: [
        { op: 'add', content: 'not saved' },
        { op: 'remove', itemId: 'missing' },
      ],
    })
  ).rejects.toMatchObject({
    failure: { code: 'ITEM_NOT_FOUND', commit: { status: 'not-committed' } },
  });
  expect((await service.inspect(target)).value).toEqual(before.value);
  await expect(
    service.configure({
      ...target,
      requestId: 'too-small',
      expectedRevision: 1,
      config: { maxContextTokens: 1 },
    })
  ).rejects.toMatchObject({
    failure: { code: 'BUDGET_EXCEEDED', details: { actual: 7, limit: 1 } },
  });
  expect((await service.inspect(target)).value).toEqual(before.value);
  const input = {
    ...target,
    requestId: 'edit',
    expectedRevision: 1,
    commands: [
      { op: 'replace' as const, itemId, content: 'new' },
      { op: 'add' as const, content: '\n  ' },
    ],
  };
  const edited = await service.apply(input);
  expect(await service.apply(input)).toEqual(edited);
  await expect(service.apply({ ...input, commands: [] })).rejects.toMatchObject({
    failure: { code: 'REQUEST_CONFLICT' },
  });
  await expect(service.apply({ ...input, requestId: 'stale' })).rejects.toMatchObject({
    failure: { code: 'REVISION_CONFLICT', details: { expectedRevision: 1, actualRevision: 2 } },
  });
  await service.configure({
    ...target,
    requestId: 'config',
    expectedRevision: 2,
    config: { render: { format: 'json' }, maxContextTokens: 200 },
  });
  expect((await service.readContext(target)).value).toMatchObject({
    snapshot: { revision: 3 },
    budget: { status: 'fits' },
  });
  await service.apply({
    ...target,
    requestId: 'empty',
    expectedRevision: 3,
    commands: [{ op: 'replace', itemId, content: '  \n' }],
  });
  expect((await service.inspect(target)).value?.items).toEqual([]);
});

it('reports missing Agent, missing Memory, malformed inputs and missing capability separately', async () => {
  const { service, setup } = await direct();
  expect(() => createContextMemoryManagementService(setup.definition)).toThrowError(
    MemoryManagementError
  );
  await expect(service.inspect({ ...target, agentId: 'missing' })).rejects.toMatchObject({
    code: 'MEMORY_AGENT_NOT_FOUND',
  });
  await expect(service.inspect(target)).rejects.toMatchObject({
    code: 'MEMORY_OPERATION_FAILED',
    failure: { code: 'MEMORY_NOT_FOUND' },
  });
  await expect(service.inspect({ ...target, memoryId: '\ud800' })).rejects.toMatchObject({
    code: 'MEMORY_INPUT_INVALID',
  });
  await expect(service.create({ ...target, requestId: '\ud800' })).rejects.toMatchObject({
    code: 'MEMORY_INPUT_INVALID',
  });
  await expect(
    service.inspect(target, { extra: true } as MemoryManagementOptions)
  ).rejects.toMatchObject({ code: 'MEMORY_INPUT_INVALID' });
});

it('preserves a matched receipt after read-time cancellation without initializing measured resources', async () => {
  const abort = new AbortController();
  let cancel = false;
  const { service } = await direct({
    store: (store) => ({
      read: store.read.bind(store),
      commit: store.commit.bind(store),
      getReceipt: async (...args) => {
        const receipt = await store.getReceipt(...args);
        if (cancel && receipt !== undefined) abort.abort();
        return receipt;
      },
    }),
  });
  const input = { ...target, requestId: 'create' };
  const original = await service.create(input);
  cancel = true;
  expect(await service.create(input, { signal: abort.signal })).toEqual(original);
  expect(abort.signal.aborted).toBe(true);
});

it.each(['apply', 'getReceipt'] as const)(
  'keeps committed evidence when %s Executor post-processing fails',
  async (operation) => {
    const fail = async (
      execution: Parameters<
        NonNullable<ReturnType<typeof createMemoryApplyDefinition>['executeStep']>
      >[0]
    ) => {
      await execution.step(execution.context);
      if (execution.stepName === 'executeOperation')
        throw new ContextMemoryError('CLEANUP_FAILED', 'private SQL /secret.db key=hidden');
    };
    const workflows =
      operation === 'apply'
        ? { apply: createMemoryApplyDefinition({ executeStep: fail }) }
        : {
            getReceipt: createMemoryGetReceiptDefinition({
              executeStep: async (execution) => {
                await execution.step(execution.context);
                if (execution.stepName === 'executeOperation')
                  throw new Error('private SQL /secret.db');
              },
            }),
          };
    const { service } = await direct({ workflows });
    await service.create({ ...target, requestId: 'create' });
    const operationPromise =
      operation === 'apply'
        ? service.apply({
            ...target,
            requestId: 'apply',
            expectedRevision: 1,
            commands: [{ op: 'add', content: 'committed' }],
          })
        : service.getReceipt({ ...target, requestId: 'create' });
    const error: unknown = await operationPromise.catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: 'MEMORY_OPERATION_FAILED',
      failure: {
        commit: { status: 'committed', receipt: { revision: operation === 'apply' ? 2 : 1 } },
      },
    });
    expect(JSON.stringify(error)).not.toContain('secret.db');
    expect(JSON.stringify(error)).not.toContain('hidden');
    expect((await service.inspect(target)).value?.revision).toBe(operation === 'apply' ? 2 : 1);
  }
);

it('preserves committed mutation facts when cancellation arrives with COMMIT completion', async () => {
  const abort = new AbortController();
  let cancel = false;
  const { service } = await direct({
    store: (store) => ({
      read: store.read.bind(store),
      getReceipt: store.getReceipt.bind(store),
      commit: async (...args) => {
        const result = await store.commit(...args);
        if (cancel) abort.abort();
        return result;
      },
    }),
  });
  await service.create({ ...target, requestId: 'create' });
  cancel = true;
  const result: unknown = await service
    .apply(
      {
        ...target,
        requestId: 'apply',
        expectedRevision: 1,
        commands: [{ op: 'add', content: 'kept' }],
      },
      { signal: abort.signal }
    )
    .catch((cause: unknown) => cause);
  if (result instanceof MemoryManagementError)
    expect(result).toMatchObject({
      failure: { commit: { status: 'committed', receipt: { revision: 2 } } },
    });
  else expect(result).toMatchObject({ value: { status: 'committed', receipt: { revision: 2 } } });
});

it('returns unknown honestly, then recovers via receipt without a second write', async () => {
  let loseReply = false;
  const commits = vi.fn();
  const { service } = await direct({
    store: (store) => ({
      read: store.read.bind(store),
      getReceipt: store.getReceipt.bind(store),
      commit: async (...args) => {
        const result = await store.commit(...args);
        commits();
        if (loseReply)
          throw new ContextMemoryError('COMMIT_STATUS_UNKNOWN', 'lost response', {
            commit: { status: 'unknown', memoryId: result.memoryId, requestId: result.requestId },
          });
        return result;
      },
    }),
  });
  await service.create({ ...target, requestId: 'create' });
  loseReply = true;
  const input = {
    ...target,
    requestId: 'apply',
    expectedRevision: 1,
    commands: [{ op: 'add' as const, content: 'once' }],
  };
  await expect(service.apply(input)).rejects.toMatchObject({
    failure: { code: 'COMMIT_STATUS_UNKNOWN', commit: { status: 'unknown' } },
  });
  expect((await service.getReceipt({ ...target, requestId: 'apply' })).value).toMatchObject({
    revision: 2,
  });
  expect((await service.apply(input)).value).toMatchObject({
    status: 'committed',
    receipt: { revision: 2 },
  });
  expect(commits).toHaveBeenCalledTimes(2);
});

it('supports concurrent Memory calls and independently cancels only the selected operation', async () => {
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { service } = await direct({
    counter: counter(async (text, signal) => {
      if (text.includes('slow')) {
        entered();
        await gate;
        signal.throwIfAborted();
      }
      return text.length;
    }),
  });
  const abort = new AbortController();
  const slow = service.create(
    { ...target, requestId: 'slow', items: [{ content: 'slow' }] },
    { signal: abort.signal }
  );
  const observed = slow.catch((cause: unknown) => cause);
  await started;
  const fast = await service.create({
    ...target,
    memoryId: 'other',
    requestId: 'fast',
    items: [{ content: 'fast' }],
  });
  expect(fast.value).toMatchObject({ status: 'committed' });
  abort.abort();
  finish();
  expect(await observed).toMatchObject({
    code: 'MEMORY_OPERATION_ABORTED',
    failure: { commit: { status: 'not-committed' } },
  });
  expect((await service.inspect({ ...target, memoryId: 'other' })).value?.items[0]?.content).toBe(
    'fast'
  );
  await expect(service.inspect(target)).rejects.toMatchObject({
    failure: { code: 'MEMORY_NOT_FOUND' },
  });
});

it('stops a write cancelled during namespace resolution before acquiring any capability', async () => {
  const { definition, store } = await direct();
  const abort = new AbortController();
  const resolve = definition.namespace.port.resolve.bind(definition.namespace.port);
  const service = createContextMemoryManagementService({
    ...definition,
    namespace: {
      port: {
        ...definition.namespace.port,
        resolve: async (id) => {
          const result = await resolve(id);
          abort.abort();
          return result;
        },
      },
    },
  });
  await expect(
    service.create({ ...target, requestId: 'create' }, { signal: abort.signal })
  ).rejects.toMatchObject({ code: 'MEMORY_OPERATION_ABORTED' });
  expect(
    await store.getReceipt(scopedAgentMemoryId('direct', 'a', 'notes'), 'create')
  ).toBeUndefined();
});

it('lets final domain arbitration recover a request committed after the preflight miss', async () => {
  const { service, definition } = await direct();
  await service.create({ ...target, requestId: 'create' });
  const resolve = definition.contextMemoryManagement.resolve;
  let raced = false;
  const concurrent = createContextMemoryManagementService({
    ...definition,
    contextMemoryManagement: {
      resolve: {
        ...resolve,
        apply: async (request, options) => {
          if (!raced) {
            raced = true;
            await (await resolve.apply(request, options)).invoke(options?.signal);
          }
          return resolve.apply(request, options);
        },
      },
    },
  });
  const input = {
    ...target,
    requestId: 'apply',
    expectedRevision: 1,
    commands: [{ op: 'add' as const, content: 'once' }],
  };
  const result = await concurrent.apply(input);
  expect(result.value).toMatchObject({ status: 'committed', receipt: { revision: 2 } });
  expect((await service.inspect(target)).value?.items.map((i) => i.content)).toEqual(['once']);
});

it('does not mistake a foreign error receipt for this target, and exposes no foreign evidence', async () => {
  const { service, definition } = await direct();
  await service.create({ ...target, requestId: 'create' });
  const other = await service.create({ ...target, memoryId: 'foreign', requestId: 'foreign' });
  if (other.value.status === 'skipped') throw new Error('Unexpected skip');
  const receipt = other.value.receipt;
  const corrupted = createContextMemoryManagementService({
    ...definition,
    contextMemoryManagement: {
      resolve: {
        ...definition.contextMemoryManagement.resolve,
        apply: (request) => ({
          memoryId: scopedAgentMemoryId(
            'direct',
            request.namespace.agentId,
            request.input.memoryId
          ),
          invoke: () =>
            Promise.reject(
              new ContextMemoryError('CLEANUP_FAILED', 'bad provider', {
                commit: { status: 'committed', receipt },
              })
            ),
        }),
      },
    },
  });
  const error: unknown = await corrupted
    .apply({ ...target, requestId: 'apply', expectedRevision: 1, commands: [] })
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ failure: { commit: { status: 'unknown', requestId: 'apply' } } });
  expect(JSON.stringify(error)).not.toContain('foreign');
});

it('does not invent non-commit when an invocation throws without evidence after writing', async () => {
  const { service, definition } = await direct();
  await service.create({ ...target, requestId: 'create' });
  const resolve = definition.contextMemoryManagement.resolve;
  const lost = createContextMemoryManagementService({
    ...definition,
    contextMemoryManagement: {
      resolve: {
        ...resolve,
        apply: async (request, options) => {
          const invocation = await resolve.apply(request, options);
          return {
            memoryId: invocation.memoryId,
            invoke: async (signal) => {
              await invocation.invoke(signal);
              throw new Error('delivery lost');
            },
          };
        },
      },
    },
  });
  await expect(
    lost.apply({
      ...target,
      requestId: 'apply',
      expectedRevision: 1,
      commands: [{ op: 'add', content: 'once' }],
    })
  ).rejects.toMatchObject({ failure: { commit: { status: 'unknown' } } });
  expect((await service.getReceipt({ ...target, requestId: 'apply' })).value).toMatchObject({
    revision: 2,
  });
});

it('an aborted receipt query makes no assertion about the original request commit', async () => {
  const { service } = await direct();
  await service.create({ ...target, requestId: 'create' });
  const abort = new AbortController();
  abort.abort();
  const error: unknown = await service
    .getReceipt({ ...target, requestId: 'create' }, { signal: abort.signal })
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: 'MEMORY_OPERATION_ABORTED' });
  if (!(error instanceof MemoryManagementError)) throw new Error('Missing error');
  expect(error.failure?.commit).toBeUndefined();
});

it('uses the official Profile after disabling an Agent, with no raw Agent materialization or credential access', async () => {
  const setup = createStandaloneMemorySetup(runtime, {
    storageNamespaceId: 'official',
    context: {},
  });
  onTestFinished(() => setup.close());
  const materialize = vi.fn(setup.definition.runtime.materialize);
  const definition = defineManagedAgentComposition({
    ...setup.definition,
    runtime: { ...setup.definition.runtime, materialize },
  });
  const agents = createAgentManagementService(definition);
  await agents.create({ identity: { id: 'a' }, config: resourceProfileConfig() });
  await agents.disable({ agentId: parseAgentId('a'), expectedIdentityRevision: 1 });
  const service = createContextMemoryManagementService(definition);
  await service.create({ ...target, requestId: 'create', items: [{ content: 'persistent' }] });
  await service.apply({
    ...target,
    requestId: 'apply',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'second' }],
  });
  expect((await service.readContext(target)).value?.text).toBe('persistent\nsecond');
  expect(materialize).not.toHaveBeenCalled();
});

it.each(['directory', 'shared'] as const)(
  'recovers %s receipts after reopen even if measurement acquisition is now unavailable',
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'context-management-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    // The two concrete namespace types are handled in their generic public Service, not cast into each other.
    async function exercise<N>(
      setup: {
        definition: import('../../src/index.js').MemoryManagedStandaloneDefinition<N>;
        close(): Promise<void>;
      },
      create: boolean
    ) {
      onTestFinished(() => setup.close());
      const service = createContextMemoryManagementService(setup.definition);
      if (create)
        await createAgentManagementService(setup.definition).create({
          identity: { id: 'a' },
          config: resourceProfileConfig(),
        });
      const result = await service.create({ ...target, requestId: 'create' });
      expect(result.value).toMatchObject({ status: 'committed', receipt: { revision: 1 } });
      expect((await service.inspect(target)).value?.revision).toBe(1);
      if (!create)
        await expect(service.readContext(target)).rejects.toMatchObject({
          failure: { code: 'TOKENIZER_UNAVAILABLE' },
        });
      await setup.close();
      return result;
    }
    // Preserve the actual namespace type at each public call.
    if (kind === 'directory') {
      const first = createStandaloneDirectorySetup(
        { ...runtime, rootDirectory: root },
        {
          storageNamespaceId: 'stable',
          context: {
            defaults: { measurementRef: 'chars' },
            acquireCounter: () => ({ value: counter() }),
          },
        }
      );
      const result = await exercise(first, true);
      const next = createStandaloneDirectorySetup(
        { ...runtime, rootDirectory: root },
        {
          storageNamespaceId: 'stable',
          context: {
            acquireCounter: () => {
              throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'offline');
            },
          },
        }
      );
      expect(await exercise(next, false)).toEqual(result);
    } else {
      const result = await exercise(
        createSharedSqliteStandaloneSetup(
          { ...runtime, databasePath: join(root, 'agents.sqlite') },
          {
            storageNamespaceId: 'stable',
            context: {
              defaults: { measurementRef: 'chars' },
              acquireCounter: () => ({ value: counter() }),
            },
          }
        ),
        true
      );
      expect(
        await exercise(
          createSharedSqliteStandaloneSetup(
            { ...runtime, databasePath: join(root, 'agents.sqlite') },
            {
              storageNamespaceId: 'stable',
              context: {
                acquireCounter: () => {
                  throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'offline');
                },
              },
            }
          ),
          false
        )
      ).toEqual(result);
    }
  }
);
