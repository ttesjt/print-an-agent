import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import type { ConversationInteractionEvent, WorkspacePorts } from '@ta-agent/ui-contracts';
import { createHttpWorkspacePorts } from '../src/browser.js';
import {
  dispatchWorkspaceCommand,
  readJsonRequest,
  writeJsonResponse,
  writeInteractionResponse,
} from '../src/node.js';
import {
  TransportProtocolError,
  workspaceCapabilities,
  workspaceCapabilitiesDecoder,
} from '../src/index.js';

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closes.splice(0).map((close) => close()));
});
function fixture(): WorkspacePorts {
  const agent = {
    agentId: 'a',
    displayName: 'Research',
    identityRevision: 'metadata:7',
    status: 'active',
    updatedAt: '2026-01-01T00:00:00Z',
  } as const;
  return {
    agents: {
      listAgentPage: (input) =>
        Promise.resolve({
          status: 'succeeded',
          value:
            input.cursor === undefined
              ? { records: [agent], nextCursor: 'opaque page' }
              : { records: [] },
        }),
      inspectAgentDetails: () =>
        Promise.resolve({ status: 'succeeded', value: { ...agent, createdAt: agent.updatedAt } }),
    },
    sessions: {
      listSessions: () => Promise.resolve({ status: 'succeeded', value: { records: [] } }),
      inspectSession: () =>
        Promise.resolve({ status: 'failed', failure: { code: 'not-found', message: 'Not found' } }),
      inspectSessionNavigation: () =>
        Promise.resolve({ status: 'failed', failure: { code: 'not-found', message: 'Not found' } }),
    },
    conversations: {
      readConversation: () => Promise.resolve({ status: 'succeeded', value: { turns: [] } }),
      streamInteraction: async (i, consume) => {
        await consume({ type: 'interaction-started', interactionId: i.interactionId });
        await consume({
          type: 'committed',
          interactionId: i.interactionId,
          receipt: { sessionId: 's', branchId: 'b', turnId: 'saved-t' },
          message: 'Saved; reload presentation.',
        });
      },
    },
  };
}
async function host(ports: WorkspacePorts) {
  const active = new Set<AbortController>();
  const server = createServer((request, response) => {
    const controller = new AbortController();
    active.add(controller);
    response.on('close', () => {
      if (!response.writableFinished) controller.abort();
    });
    void (async () => {
      const body = await readJsonRequest(request, controller.signal);
      if (request.url === '/interactions')
        await writeInteractionResponse(ports.conversations, body, response, controller.signal);
      else
        writeJsonResponse(response, await dispatchWorkspaceCommand(ports, body, controller.signal));
    })()
      .catch(() => response.destroy())
      .finally(() => active.delete(controller));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No address');
  closes.push(async () => {
    for (const c of active) c.abort();
    const done = new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve()))
    );
    server.closeAllConnections();
    await done;
  });
  return createHttpWorkspacePorts({
    baseUrl: `http://127.0.0.1:${address.port}`,
    capabilities: workspaceCapabilities(ports),
  });
}
it('shares a real paged, read-only backend without installing unsupported mutations', async () => {
  const ports = await host(fixture());
  expect(ports.agents.disableAgent).toBeUndefined();
  expect(ports.sessions.purgeSession).toBeUndefined();
  expect(ports.conversations.forkSessionBranch).toBeUndefined();
  expect(await ports.agents.listAgentPage({})).toMatchObject({
    status: 'succeeded',
    value: { nextCursor: 'opaque page' },
  });
  expect(await ports.agents.listAgentPage({ cursor: 'opaque page' })).toEqual({
    status: 'succeeded',
    value: { records: [] },
  });
  const events: ConversationInteractionEvent[] = [];
  await ports.conversations.streamInteraction(
    { agentId: 'a', interactionId: 'i', message: 'hello' },
    (e) => {
      events.push(e);
      return Promise.resolve();
    }
  );
  expect(events.map((e) => e.type)).toEqual(['interaction-started', 'committed']);
});
it('rejects undeclared capabilities and closed-record violations', async () => {
  expect(() => workspaceCapabilitiesDecoder.decode({ purgeSession: 'yes' })).toThrow(
    TransportProtocolError
  );
  expect(() => workspaceCapabilitiesDecoder.decode({ madeUp: true })).toThrow(
    TransportProtocolError
  );
  await expect(
    dispatchWorkspaceCommand(
      fixture(),
      {
        command: 'purgeSession',
        input: {
          agentId: 'a',
          sessionId: 's',
          expectedRevision: 'r',
          confirmation: 'permanently-delete-session',
        },
      },
      new AbortController().signal
    )
  ).rejects.toThrow(TransportProtocolError);
  await expect(
    dispatchWorkspaceCommand(
      fixture(),
      { command: 'listAgentPage', input: { extra: true } },
      new AbortController().signal
    )
  ).rejects.toThrow(TransportProtocolError);
});
it('latches a swallowed post-terminal violation and never publishes a saved outcome', async () => {
  const f = fixture();
  const original = f.conversations.streamInteraction.bind(f.conversations);
  const ports = await host({
    ...f,
    conversations: {
      ...f.conversations,
      streamInteraction: async (i, consume) => {
        await original(i, consume);
        await consume({
          type: 'text-delta',
          interactionId: i.interactionId,
          modelTurnIndex: 1,
          delta: 'late',
        }).catch(() => undefined);
      },
    },
  });
  const events: ConversationInteractionEvent[] = [];
  await ports.conversations.streamInteraction(
    { agentId: 'a', interactionId: 'i', message: 'hello' },
    (e) => {
      events.push(e);
      return Promise.resolve();
    }
  );
  expect(events.some((e) => e.type === 'committed' || e.type === 'completed')).toBe(false);
  expect(events.at(-1)?.type).toBe('failed');
});
it('waits for consumer backpressure and preserves cancellation', async () => {
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const data = [
    { type: 'interaction-started', interactionId: 'i' },
    { type: 'cancelled', interactionId: 'i' },
  ];
  const ports = createHttpWorkspacePorts({
    fetch: () =>
      Promise.resolve(
        new Response(data.map((e) => JSON.stringify(e)).join('\n') + '\n', {
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
      ),
  });
  const events: string[] = [];
  const run = ports.conversations.streamInteraction(
    { agentId: 'a', interactionId: 'i', message: 'hello' },
    async (e) => {
      events.push(e.type);
      if (e.type === 'interaction-started') await pending;
    }
  );
  await new Promise<void>((r) => setTimeout(r, 0));
  expect(events).toEqual(['interaction-started']);
  release();
  await run;
  expect(events).toEqual(['interaction-started', 'cancelled']);
});
