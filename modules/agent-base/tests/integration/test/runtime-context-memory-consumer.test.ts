import { expect, it, vi } from 'vitest';
import {
  createSessionContextMemory,
  createContextMemoryTools,
  createDeterministicAgentAPI,
} from '@print-an-agent/base-composition';
import { MemorySessionAdapter } from '@print-an-agent/base-local-adapters';
import { executeSessionNavigation } from '@print-an-agent/base-session';
import { BUILT_IN_RESPONSIBILITIES } from '@print-an-agent/base-actor';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import {
  createVersionedContextMemoryBundle,
  createVersionedContextMemoryResources,
  createMemoryReadVersionContextDefinition,
  MemoryMeter,
} from '@print-an-agent/context-memory';
import { IndependentHistoryStore } from './support/independent-memory-store.js';
import { parseToolName } from '@print-an-agent/base-tool';
import { SKIP_STEP } from '@print-an-agent/workflow-core';

it('consumes public contracts with independent resources, custom tools/Steps, exact pinning and inherited forks', async () => {
  const store = new IndependentHistoryStore();
  const counter = (ref: string) =>
    createTokenCounter({
      measurementRef: ref,
      inputContract: TEXT_TOKEN_INPUT_CONTRACT,
      measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
    });
  const measured: string[] = [];
  const readStep = vi.fn();
  const memory = createVersionedContextMemoryBundle({
    resources: createVersionedContextMemoryResources({
      store,
      defaults: { measurementRef: 'old' },
      meter: new MemoryMeter({
        resolveCounter: (ref) => {
          measured.push(ref);
          return counter(ref);
        },
      }),
    }),
    workflows: {
      readVersionContext: createMemoryReadVersionContextDefinition({
        stepOverrides: {
          executeOperation: async (context) => {
            readStep();
            const input = context.state.preparedInput;
            if (input === undefined) throw new Error('Expected a prepared version-context input.');
            const value = await context.resources.memory.readVersionContext(input, context.signal);
            context.state.operationOutput = { value };
          },
        },
      }),
    },
  });
  const session = new MemorySessionAdapter();
  const service = createSessionContextMemory({
    authorityId: 'independent',
    session,
    memory: memory.workflows,
    createTools: (scope) =>
      createContextMemoryTools({ ...scope, writable: false }).map((t) => ({
        ...t,
        name: parseToolName('inspect_notes'),
      })),
  });
  const names = ['inspect_notes'];
  let race = false;
  const inspect = memory.workflows.inspect.run.bind(memory.workflows.inspect);
  vi.spyOn(memory.workflows.inspect, 'run').mockImplementation(async (call) => {
    const snapshot = await inspect(call);
    if (!race && snapshot !== undefined) {
      race = true;
      await memory.workflows.configure.run({
        input: {
          memoryId: snapshot.memoryId,
          requestId: 'change-counter',
          expectedRevision: snapshot.revision,
          config: { measurementRef: 'new' },
        },
      });
      measured.length = 0;
    }
    return snapshot;
  });
  const agent = createDeterministicAgentAPI({
    identity: { id: 'independent' },
    session,
    contextMemory: service,
    mainActor: { allowedTools: names },
    productToolAllowList: names,
    runtimeToolAllowList: names,
    responsibilities: BUILT_IN_RESPONSIBILITIES.map((r) => ({ ...r, allowedTools: names })),
    provider: {
      responses: [
        { status: 'success', text: 'done' },
        { status: 'tool-call', name: 'inspect_notes', callId: 'read', arguments: {} },
        { status: 'success', text: 'branch' },
      ],
    },
  });
  const first = await agent.run({ message: 'hello' });
  const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
  const checkpoint = await service.readCheckpoint(ref, first.requestId);
  expect(checkpoint?.input.revision).toBe(1);
  expect(measured[0]).toBe('old'); // head changed to another counter before rendering
  expect(readStep).toHaveBeenCalledOnce();
  const port = service.navigationPort(session);
  const snapshot = (await session.inspect(ref))!;
  const fork = await executeSessionNavigation({
    agentId: ref.agentId,
    session: port,
    navigation: {
      sessionId: ref.sessionId,
      operation: 'fork',
      sourceBranchId: 'main',
      throughTurnId: first.requestId,
      expectedRevision: snapshot.navigation.revision,
    },
  });
  if (fork.status !== 'forked') throw new Error('Expected fork');
  await executeSessionNavigation({
    agentId: ref.agentId,
    session: port,
    navigation: {
      sessionId: ref.sessionId,
      operation: 'select',
      branchId: fork.affectedBranchId,
      expectedRevision: fork.revision,
    },
  });
  const branch = await agent.run({ sessionId: ref.sessionId, message: 'branch' });
  const current = (await session.inspect(ref))!;
  const inherited = await executeSessionNavigation({
    agentId: ref.agentId,
    session: port,
    navigation: {
      sessionId: ref.sessionId,
      operation: 'fork',
      sourceBranchId: fork.affectedBranchId,
      throughTurnId: first.requestId,
      expectedRevision: current.navigation.revision,
    },
  });
  if (inherited.status !== 'forked') throw new Error('Expected inherited fork');
  const derived = await service.inspect({ ...ref, branchId: inherited.affectedBranchId });
  expect(derived?.revision).toBe(1);
  expect(derived?.config.measurementRef).toBe('old');
  if (checkpoint === undefined || derived === undefined)
    throw new Error('Missing immutable versions');
  store.heads.delete(checkpoint.input.memoryId);
  store.versions.delete(checkpoint.input.memoryId);
  expect(
    (
      await memory.workflows.readVersionContext.run({
        input: { memoryId: derived.memoryId, revision: 1 },
      })
    )?.snapshot.config.measurementRef
  ).toBe('old');
  expect((await service.readCheckpoint(ref, branch.requestId))?.input.memoryId).not.toBe(
    checkpoint?.input.memoryId
  );
});

it('can install an independent read capability or replace the named loading Step without Registry', async () => {
  const settle = vi.fn(() => Promise.resolve());
  const open = vi.fn(
    (target: Parameters<import('@print-an-agent/base-request').RequestContextMemory['open']>[0]) =>
      Promise.resolve({
        inputVersion: { memoryId: target.session.sessionId, revision: 1 },
        text: 'custom external context',
        tools: [],
        settle,
      })
  );
  const source = { open };
  const regular = createDeterministicAgentAPI({
    identity: { id: 'custom' },
    contextMemory: source,
    provider: {
      responses: [(r) => ({ status: 'success', text: r.messages.map((m) => m.text).join('|') })],
    },
  });
  expect((await regular.run({ message: 'read' })).message.text).toContain(
    'custom external context'
  );
  const replaced = createDeterministicAgentAPI({
    identity: { id: 'custom-skip' },
    contextMemory: source,
    stepOverrides: { loadContextMemory: SKIP_STEP },
    provider: { responses: [{ status: 'success', text: 'plain' }] },
  });
  await replaced.run({ message: 'no implicit dependency' });
  expect(open).toHaveBeenCalledOnce();
  expect(settle).toHaveBeenCalledOnce();
});
