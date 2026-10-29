import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import { parseAgentId } from '@ta-agent/base-identity';
import { parseTurnId } from '@ta-agent/base-session';
import type {
  StandaloneSetup,
  MemoryManagedStandaloneDefinition,
  StandaloneSessionContextMemory,
} from '../../src/index.js';
import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionNavigationService,
  createContextMemoryManagementService,
  createSessionManagementService,
} from '@ta-agent/base-composition';
import { createTokenCounter, TEXT_TOKEN_INPUT_CONTRACT } from '@ta-agent/model-invocation-core';
import {
  createStandaloneDirectorySetup,
  createStandaloneMemorySetup,
  createSharedSqliteStandaloneSetup,
  defineStandaloneAgentConfig,
} from '../../src/index.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../support/resource-profile.js';
import { compactionServer } from '../support/compaction-server.js';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';
import { ContextMemoryError, createMemoryApplyDefinition } from '@ta-agent/context-memory';

const memory = {
  storageNamespaceId: 'runtime-tests',
  context: {
    defaults: { measurementRef: 'chars' },
    acquireCounter: () => ({
      value: createTokenCounter({
        measurementRef: 'chars',
        inputContract: TEXT_TOKEN_INPUT_CONTRACT,
        measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
      }),
    }),
    runtime: { writable: true },
  },
};
const tool = (content: string) => ({
  name: 'apply_context_memory',
  callId: content,
  arguments: { expectedRevision: 1, commands: [{ op: 'add', itemId: '', content }] },
});

function profileCase<N>(
  profile: string,
  create: (root: string) => StandaloneSetup<N> & {
    definition: MemoryManagedStandaloneDefinition<N>;
    sessionContextMemory?: StandaloneSessionContextMemory;
  }
) {
  it(`${profile}: official raw Agent tools, historical fork, independence and reopen`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-memory-profile-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const server = await compactionServer([
      tool('original'),
      'saved',
      'later',
      tool('branch-only'),
      'branched',
      'original again',
      'reopened',
    ]);
    onTestFinished(() => server.close());
    const factory = () => create(root);
    let setup = factory();
    onTestFinished(() => setup.close());
    const base = resourceProfileConfig();
    const config = defineStandaloneAgentConfig({
      ...base,
      provider: {
        ...base.provider,
        config: {
          ...base.provider.config,
          kind: 'openai-compatible',
          reference: { provider: 'fixture', model: 'fixture', baseUrl: server.baseUrl },
        },
      },
      mainActor: base.mainActor,
    });
    const created = await createAgentManagementService(setup.definition).create({
      identity: { id: 'a' },
      config,
    });
    const agentId = created.authority.identity.identity.id;
    let raw = await createAgentRuntimeService(setup.definition).open(agentId);
    const first = await raw.invoke('foreground', { message: 'remember original' });
    const ref = { agentId, sessionId: first.sessionId };
    const service = await setup.sessionContextMemory!.resolve(agentId);
    const cp = await service.readCheckpoint(ref, first.requestId);
    expect(cp?.input.revision).toBe(1);
    expect(cp?.final.revision).toBe(2);
    await raw.invoke('foreground', { sessionId: first.sessionId, message: 'later' });
    const nav = createSessionNavigationService(setup.definition);
    const snapshot = await nav.inspect(ref);
    const fork = await nav.fork({
      ...ref,
      sourceBranchId: snapshot.navigation.selectedBranchId,
      throughTurnId: parseTurnId(first.requestId),
      expectedRevision: snapshot.navigation.revision,
    });
    await nav.select({ ...ref, branchId: fork.affectedBranchId, expectedRevision: fork.revision });
    const branched = await raw.invoke('foreground', {
      sessionId: first.sessionId,
      message: 'remember branch-only',
    });
    const bp = await service.readCheckpoint(ref, branched.requestId);
    expect(bp?.final.memoryId).not.toBe(cp?.final.memoryId);
    expect(bp?.input.revision).toBe(1);
    const current = await nav.inspect(ref);
    await nav.select({
      ...ref,
      branchId: snapshot.navigation.selectedBranchId,
      expectedRevision: current.navigation.revision,
    });
    const original = await raw.invoke('foreground', {
      sessionId: first.sessionId,
      message: 'back',
    });
    expect((await service.readCheckpoint(ref, original.requestId))?.final).toEqual(cp?.final);
    if (profile !== 'memory') {
      await setup.close();
      setup = factory();
      raw = await createAgentRuntimeService(setup.definition).open(agentId);
      const reopened = await raw.invoke('foreground', {
        sessionId: first.sessionId,
        message: 'reopen',
      });
      expect(
        (
          await (
            await setup.sessionContextMemory!.resolve(agentId)
          ).readCheckpoint(ref, reopened.requestId)
        )?.input
      ).toEqual(cp?.final);
    }
    expect(server.requests.length).toBe(profile === 'memory' ? 6 : 7);
  });
}
const runtime = { readEnvironmentVariable: () => undefined };
profileCase('memory', () => createStandaloneMemorySetup(runtime, memory));
profileCase('directory', (root) =>
  createStandaloneDirectorySetup({ ...runtime, rootDirectory: root }, memory)
);
profileCase('shared', (root) =>
  createSharedSqliteStandaloneSetup(
    { ...runtime, databasePath: join(root, 'agents.sqlite') },
    memory
  )
);

it('management alone stays runtime-disabled and per-Agent installation is explicit', async () => {
  const options = resourceProfileRuntimeOptions(() => undefined);
  const setup = createStandaloneMemorySetup(options, {
    ...memory,
    context: { ...memory.context, runtime: { enabled: (id) => id !== 'off' } },
  });
  onTestFinished(() => setup.close());
  const agents = createAgentManagementService(setup.definition);
  for (const id of ['off', 'on'])
    await agents.create({ identity: { id }, config: resourceProfileConfig() });
  const off = await createAgentRuntimeService(setup.definition).open(parseAgentId('off'));
  const result = await off.invoke('foreground', { message: 'no memory' });
  await expect(setup.sessionContextMemory!.resolve('off')).rejects.toThrow('disabled');
  const on = await createAgentRuntimeService(setup.definition).open(parseAgentId('on'));
  const active = await on.invoke('foreground', { message: 'memory' });
  const service = await setup.sessionContextMemory!.resolve('on');
  await expect(
    service.readCheckpoint(
      { agentId: parseAgentId('on'), sessionId: active.sessionId },
      active.requestId
    )
  ).resolves.toMatchObject({ settled: true });
  await expect(
    service.readCheckpoint(
      { agentId: parseAgentId('off'), sessionId: result.sessionId },
      result.requestId
    )
  ).rejects.toMatchObject({ code: 'SESSION_MEMORY_INVALID' });
});

it('current-only custom roots remain manageable but cannot pretend to support runtime history', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const setup = createStandaloneMemorySetup(
    resourceProfileRuntimeOptions(() => undefined),
    {
      ...memory,
      context: {
        ...memory.context,
        acquireStore: () => ({
          value: {
            read: store.read.bind(store),
            getReceipt: store.getReceipt.bind(store),
            commit: store.commit.bind(store),
          },
        }),
      },
    }
  );
  onTestFinished(async () => {
    await setup.close();
    store.close();
  });
  await createAgentManagementService(setup.definition).create({
    identity: { id: 'current' },
    config: resourceProfileConfig(),
  });
  const management = createContextMemoryManagementService(setup.definition);
  await management.create({ agentId: 'current', memoryId: 'notes', requestId: 'create' });
  await expect(
    createAgentRuntimeService(setup.definition).open(parseAgentId('current'))
  ).rejects.toMatchObject({ code: 'MANAGED_AGENT_OPERATION_FAILED' });
  expect(
    (await management.inspect({ agentId: 'current', memoryId: 'notes' })).value?.revision
  ).toBe(1);
});

it('requires an explicit baseline when enabling Memory for existing history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-memory-baseline-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const options = { ...resourceProfileRuntimeOptions(() => undefined), rootDirectory: root };
  const before = createStandaloneDirectorySetup(options);
  await createAgentManagementService(before.definition).create({
    identity: { id: 'existing' },
    config: resourceProfileConfig(),
  });
  const first = await (
    await createAgentRuntimeService(before.definition).open(parseAgentId('existing'))
  ).invoke('foreground', { message: 'old history' });
  await before.close();
  const after = createStandaloneDirectorySetup(options, memory);
  onTestFinished(() => after.close());
  const raw = await createAgentRuntimeService(after.definition).open(parseAgentId('existing'));
  await expect(
    raw.invoke('foreground', { sessionId: first.sessionId, message: 'not implicit' })
  ).rejects.toMatchObject({ code: 'SESSION_MEMORY_NOT_CONFIGURED' });
  const service = await after.sessionContextMemory!.resolve('existing');
  await service.initialize({
    agentId: parseAgentId('existing'),
    sessionId: first.sessionId,
    branchId: (
      await raw.resources.session.resolve({
        agentId: parseAgentId('existing'),
        sessionId: first.sessionId,
      })
    ).branchId,
  });
  const next = await raw.invoke('foreground', {
    sessionId: first.sessionId,
    message: 'now explicit',
  });
  expect(
    (
      await service.readCheckpoint(
        { agentId: parseAgentId('existing'), sessionId: first.sessionId },
        next.requestId
      )
    )?.settled
  ).toBe(true);
  expect(
    await service.readCheckpoint(
      { agentId: parseAgentId('existing'), sessionId: first.sessionId },
      first.requestId
    )
  ).toBeUndefined();
});

it('does not close live runtime dependencies before the Host joins its business call', async () => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const release = vi.fn();
  const store = new SqliteMemoryStore({ path: ':memory:' });
  onTestFinished(() => store.close());
  const standard = resourceProfileRuntimeOptions(() => undefined);
  const invoke = standard.stepOverrides!.invokeActorInteraction!;
  if (typeof invoke !== 'function') throw new Error('Expected invocation fixture');
  const setup = createStandaloneMemorySetup(
    {
      ...standard,
      stepOverrides: {
        invokeActorInteraction: async (context) => {
          entered.resolve();
          await gate.promise;
          await invoke(context);
        },
      },
    },
    { ...memory, context: { ...memory.context, acquireStore: () => ({ value: store, release }) } }
  );
  await createAgentManagementService(setup.definition).create({
    identity: { id: 'live' },
    config: resourceProfileConfig(),
  });
  const raw = await createAgentRuntimeService(setup.definition).open(parseAgentId('live'));
  const operation = raw.invoke('foreground', { message: 'wait' });
  await entered.promise;
  await expect(setup.close({ mode: 'abort' })).rejects.toThrow('Stop and join');
  expect(release).not.toHaveBeenCalled();
  gate.resolve();
  await operation;
  await setup.close({ mode: 'abort' });
  expect(release).toHaveBeenCalledOnce();
});

it('retains Memory Workflow cleanup failure in the Profile shutdown owner', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const release = vi.fn();
  onTestFinished(() => store.close());
  const setup = createStandaloneMemorySetup(
    resourceProfileRuntimeOptions(() => undefined),
    {
      ...memory,
      context: {
        ...memory.context,
        acquireStore: () => ({ value: store, release }),
        runtime: {
          writable: true,
          workflows: {
            apply: createMemoryApplyDefinition({
              lifecycle: {
                onFinally: () => {
                  throw new ContextMemoryError('CLEANUP_FAILED', 'unconfirmed worker cleanup');
                },
              },
            }),
          },
        },
      },
    }
  );
  await createAgentManagementService(setup.definition).create({
    identity: { id: 'failed-cleanup' },
    config: resourceProfileConfig(),
  });
  const raw = await createAgentRuntimeService(setup.definition).open(
    parseAgentId('failed-cleanup')
  );
  const first = await raw.invoke('foreground', { message: 'init' });
  const service = await setup.sessionContextMemory!.resolve('failed-cleanup');
  const branch = await raw.resources.session.resolve({
    agentId: raw.identity.id,
    sessionId: first.sessionId,
  });
  await expect(
    service.apply(branch, {
      requestId: 'write',
      expectedRevision: 1,
      commands: [{ op: 'add', content: 'committed' }],
    })
  ).rejects.toMatchObject({
    code: 'SESSION_MEMORY_CLEANUP_FAILED',
    commit: { status: 'committed' },
  });
  const management = createSessionManagementService(setup.definition);
  const ref = { agentId: raw.identity.id, sessionId: first.sessionId };
  const state = await management.inspect(ref);
  if (state === undefined) throw new Error('Missing recovery fence');
  const failure: unknown = await management
    .recover({ ...ref, expectedExecutionRevision: state.execution.revision })
    .catch((cause: unknown) => cause);
  expect(failure).toMatchObject({
    code: 'SESSION_MEMORY_CLEANUP_FAILED',
    commit: { status: 'committed' },
  });
  expect(JSON.stringify(failure)).not.toContain('unconfirmed worker cleanup');
  await expect(setup.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
  expect(release).not.toHaveBeenCalled();
  await expect(setup.close({ mode: 'abort' })).rejects.toMatchObject({
    code: 'RESOURCE_CLEANUP_FAILED',
  });
  expect(release).not.toHaveBeenCalled();
});
