// @vitest-environment node
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { defineActorEngine, type ActorEngine } from '@ta-agent/model-invocation-core';
import type { ConversationInteractionEvent } from '@ta-agent/ui-contracts';
import { createDirectoryCollectionHost } from '../../src/node/collections/directory-host.js';
import { createDirectoryCollectionAccess } from '../../src/adapters/directory-collection-access.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { parseHostArguments } from '../../src/node/host-arguments.js';
import { engineConfig } from '../support/agent-config.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});
async function fixture(initialRoot = false, engine: ActorEngine = createOfflineWebEngine()) {
  const root = await mkdtemp(join(tmpdir(), 'agent-web-collections-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const collections = await createDirectoryCollectionHost({
    engine,
    ...(initialRoot ? { initialRoot: join(root, 'first') } : {}),
  });
  const server = await startLocalAgentWebServer({ collections });
  cleanup.push(server.close);
  return {
    root,
    collections,
    server,
    access: createDirectoryCollectionAccess(`${server.origin}/api`),
    signal: new AbortController().signal,
  };
}
function value<T>(
  result: { status: 'succeeded'; value: T } | { status: 'failed'; failure: unknown }
): T {
  if (result.status === 'failed') throw new Error(JSON.stringify(result.failure));
  return result.value;
}

it('does not invent a default root; UI opening and CLI bootstrap share canonical directory identity', async () => {
  const { root, access, signal, server } = await fixture();
  expect(await access.bootstrap(signal)).toEqual({});
  const opened = await access.openCollection({
    reference: { rootDirectory: join(root, 'first') },
    signal,
  });
  if (!opened.ok) throw new Error(opened.message);
  const initial = await createDirectoryCollectionHost({
    initialRoot: join(root, 'first', '..', 'first'),
  });
  expect((await initial.bootstrap(signal)).initialCollection).toEqual(opened.collection);
  expect(opened.collection.reference.rootDirectory).toBe(await realpath(join(root, 'first')));
  const response = await fetch(`${server.origin}/api/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'listAgents', input: {} }),
  });
  expect(response.status).toBe(404);
});

it('reuses aliases but isolates Agent identity, provider config, journal and history between Collections', async () => {
  const { root, access, signal, collections } = await fixture();
  const first = await access.openCollection({
    reference: { rootDirectory: join(root, 'first') },
    signal,
  });
  const second = await access.openCollection({
    reference: { rootDirectory: join(root, 'second') },
    signal,
  });
  if (!first.ok || !second.ok) throw new Error('Open failed');
  await symlink(join(root, 'first'), join(root, 'alias'));
  const alias = await access.openCollection({
    reference: { rootDirectory: join(root, 'alias') },
    signal,
  });
  if (!alias.ok) throw new Error(alias.message);
  expect(alias.collection.key).toBe(first.collection.key);
  expect(collections.resolve(first.collection.key)).not.toBe(
    collections.resolve(second.collection.key)
  );
  expect(collections.resolve(alias.collection.key)).toBe(collections.resolve(first.collection.key));
  for (const [binding, label] of [
    [first, 'First'],
    [second, 'Second'],
  ] as const) {
    const ports = binding.connection.ports;
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'same-id', displayName: label },
        config: { ...engineConfig(), instructions: label },
      })
    );
    const events: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'same-id', interactionId: 'same-logical-id', message: label },
      (event) => {
        events.push(event);
        return Promise.resolve();
      }
    );
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('completed');
    if (terminal?.type !== 'completed') throw new Error('No completed turn');
    expect(terminal.turn.assistantMessage.text).toContain(label);
    expect(
      value(await ports.sessions.listSessions({ agentId: 'same-id', status: 'active' })).records
    ).toHaveLength(1);
  }
  expect(
    value(await first.connection.ports.agents.readAgentConfig({ agentId: 'same-id' })).value
      .instructions
  ).toBe('First');
  expect(value(await second.connection.ports.agents.listAgents())[0]?.displayName).toBe('Second');
});

it('validates locators, bounds folder browsing and preserves cancellation', async () => {
  const { root, collections, signal } = await fixture(true);
  await mkdir(join(root, 'child'));
  await writeFile(join(root, 'file'), 'not a directory');
  const listing = await collections.browse(root, signal);
  expect(listing.directories.map((entry) => entry.label)).toEqual(['child', 'first']);
  expect((await collections.open({ rootDirectory: join(root, 'file') }, signal)).ok).toBe(false);
  expect((await collections.open({ rootDirectory: 'relative' }, signal)).ok).toBe(false);
  expect((await collections.open({ rootDirectory: '/' }, signal)).ok).toBe(false);
  await expect(collections.open({ rootDirectory: root, extra: true }, signal)).rejects.toThrow();
  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  await expect(collections.open({ rootDirectory: root }, controller.signal)).rejects.toThrow(
    'caller cancelled'
  );
});

it('allows simultaneous interactions with identical Agent and request IDs in separate Collections', async () => {
  const offline = createOfflineWebEngine();
  const interact = offline.interact;
  if (interact === undefined) throw new Error('Offline fixture does not support interaction');
  let arrivals = 0;
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const engine = defineActorEngine({
    ...offline,
    interact: async (request) => {
      arrivals++;
      await barrier;
      return interact(request);
    },
  });
  const { root, access, signal } = await fixture(false, engine);
  const bindings = await Promise.all(
    ['first', 'second'].map(async (label) => {
      const result = await access.openCollection({
        reference: { rootDirectory: join(root, label) },
        signal,
      });
      if (!result.ok) throw new Error(result.message);
      value(
        await result.connection.ports.agents.createAgent({
          identity: { agentId: 'same-id', displayName: label },
          config: engineConfig(engine.id),
        })
      );
      return {
        label,
        ports: result.connection.ports,
        events: [] as ConversationInteractionEvent[],
      };
    })
  );
  const runs = bindings.map(({ label, ports, events }) =>
    ports.conversations.streamInteraction(
      { agentId: 'same-id', interactionId: 'same-request-id', message: label },
      (event) => {
        events.push(event);
        return Promise.resolve();
      }
    )
  );
  try {
    // Both must reach the Engine before either invocation is allowed to finish.
    await vi.waitFor(() => expect(arrivals).toBe(2));
  } finally {
    release();
    await Promise.all(runs);
  }
  for (const { label, events } of bindings) {
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('completed');
    if (terminal?.type !== 'completed') throw new Error('Missing committed turn');
    expect(terminal.turn.assistantMessage.text).toBe(`Offline reply: ${label}`);
  }
});

it('keeps --root a path-only optional shortcut and rejects ambiguous CLI inputs', () => {
  expect(parseHostArguments([])).toEqual({ port: 4174 });
  expect(parseHostArguments(['--root', 'research', '--port', '4175'])).toEqual({
    port: 4175,
    initialRoot: resolve('research'),
  });
  expect(() => parseHostArguments(['--root', ''])).toThrow();
  expect(() => parseHostArguments(['--root', 'a', '--root', 'b'])).toThrow();
  expect(() => parseHostArguments(['--config', '{}'])).toThrow();
});
