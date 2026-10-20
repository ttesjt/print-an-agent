// @vitest-environment node
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it } from 'vitest';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import type {
  TemporaryConversationEvent,
  TemporaryConversationPort,
} from '../../src/temporary-conversation/contracts.js';
import { temporaryEngine, temporaryMessage } from '../support/temporary-model.js';
import { engineConfig } from '../support/agent-config.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const input = {
  agentId: 'demo',
  interactionId: 'send',
  expectedConfigRevision: '1',
  message: 'hello',
  history: [],
};
async function host(port?: TemporaryConversationPort) {
  const backend = createAgentBaseWebPorts({
    persistence: { kind: 'memory' },
    engine: temporaryEngine(),
  });
  await backend.agents.createAgent({
    identity: { agentId: 'demo', displayName: 'Demo' },
    config: engineConfig('temporary.fixture'),
  });
  const server = await startLocalAgentWebServer({
    ports: port === undefined ? backend : { ...backend, temporaryConversations: port },
  });
  cleanup.push(server.close);
  return { backend, server, ports: createHttpAgentWebPorts({ baseUrl: server.origin + '/api' }) };
}

it('streams a temporary response through the real host without creating a Session', async () => {
  const f = await host();
  const received: TemporaryConversationEvent[] = [];
  await f.ports.temporaryConversations?.streamTemporaryConversation(input, (event) => {
    received.push(event);
    return Promise.resolve();
  });
  expect(received.map((event) => event.type)).toEqual([
    'opened',
    'reasoning-delta',
    'text-delta',
    'completed',
  ]);
  expect(
    await f.backend.sessions.listSessions({ agentId: 'demo', status: 'active' })
  ).toMatchObject({ status: 'succeeded', value: { records: [] } });
  const rejected = await fetch(f.server.origin + '/api/temporary-conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, provider: 'forbidden' }),
  });
  expect(rejected.status).toBe(400);
  const denied = await fetch(f.server.origin + '/api/temporary-conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.invalid' },
    body: JSON.stringify(input),
  });
  expect(denied.status).toBe(403);
});

it('does not promote a terminal when the backend rejects after delivery', async () => {
  const f = await host({
    streamTemporaryConversation: async (request, consume) => {
      await consume({ type: 'opened', interactionId: request.interactionId });
      await consume({
        type: 'completed',
        interactionId: request.interactionId,
        configRevision: '1',
        assistant: {
          text: 'answer',
          timestamp: new Date(1).toISOString(),
          stopReason: 'stop',
          reasoningBlocks: [],
        },
      });
      throw new Error('late failure');
    },
  });
  const events: TemporaryConversationEvent[] = [];
  await expect(
    f.ports.temporaryConversations?.streamTemporaryConversation(input, (event) => {
      events.push(event);
      return Promise.resolve();
    })
  ).rejects.toBeDefined();
  expect(events.every((event) => event.type !== 'completed')).toBe(true);
});

it('aborts and drains an active temporary Engine during host shutdown', async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const backend = createAgentBaseWebPorts({
    persistence: { kind: 'memory' },
    engine: temporaryEngine(async (request) => {
      started.resolve(request.signal);
      await release.promise;
      request.signal.throwIfAborted();
      return { message: temporaryMessage() };
    }),
  });
  await backend.agents.createAgent({
    identity: { agentId: 'demo', displayName: 'Demo' },
    config: engineConfig('temporary.fixture'),
  });
  const server = await startLocalAgentWebServer({ ports: backend });
  cleanup.push(server.close);
  const ports = createHttpAgentWebPorts({ baseUrl: server.origin + '/api' });
  const request = ports.temporaryConversations?.streamTemporaryConversation(input, () =>
    Promise.resolve()
  );
  const observed = request?.catch(() => undefined);
  const signal = await started.promise;
  let closed = false;
  const closing = server.close().then(() => {
    closed = true;
  });
  try {
    await setImmediate();
    expect(signal.aborted).toBe(true);
    expect(closed).toBe(false);
  } finally {
    release.resolve();
    await closing;
    await observed;
  }
});
