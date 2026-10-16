// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { defineActorEngine } from '@ta-agent/model-invocation-core';
import { createToolRegistry, defineTool } from '@ta-agent/base-tool';
import type { ConversationInteractionEvent } from '@ta-agent/ui-contracts';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { commands } from '../../src/transport/commands.js';
import { interactionEvent } from '../../src/transport/schemas.js';
import { WEB_TRANSPORT_LIMITS } from '../../src/transport/limits.js';
import { providerServer } from '../support/provider-server.js';
import { engineConfig, providerConfig } from '../support/agent-config.js';
import {
  createSubmittingInteraction,
  reduceInteractionEvent,
} from '@ta-agent/ui-workspace/testing';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
const config = engineConfig();
function value<T>(
  result: { status: 'succeeded'; value: T } | { status: 'failed'; failure: unknown }
): T {
  if (result.status === 'failed') throw new Error(JSON.stringify(result.failure));
  return result.value;
}
async function host(engine = createOfflineWebEngine()) {
  const server = await startLocalAgentWebServer({
    ports: createAgentBaseWebPorts({ engine, persistence: { kind: 'memory' } }),
  });
  cleanup.push(server.close);
  return { ...server, ports: createHttpAgentWebPorts({ baseUrl: `${server.origin}/api` }) };
}
function collect(events: ConversationInteractionEvent[]) {
  return (event: ConversationInteractionEvent) => {
    events.push(event);
    return Promise.resolve();
  };
}

describe('local HTTP and NDJSON transport', () => {
  it('renames only Agent identity through HTTP with CAS, preserving config and Session', async () => {
    const { ports } = await host();
    const original = value(
      await ports.agents.createAgent({
        identity: { agentId: 'name', displayName: 'Before' },
        config,
      })
    );
    const events: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'name', interactionId: 'rename-session', message: 'Hello' },
      collect(events)
    );
    const renamed = value(
      await ports.agents.renameAgent({
        agentId: 'name',
        displayName: 'After',
        expectedRevision: original.details.identityRevision,
      })
    );
    expect(renamed.agentId).toBe('name');
    expect(renamed.displayName).toBe('After');
    const conflict = await ports.agents.renameAgent({
      agentId: 'name',
      displayName: 'Stale',
      expectedRevision: original.details.identityRevision,
    });
    expect(conflict).toMatchObject({ status: 'failed', failure: { code: 'revision-conflict' } });
    expect(value(await ports.agents.inspectAgent({ agentId: 'name' })).config).toEqual(
      original.config
    );
    expect(
      value(await ports.sessions.listSessions({ agentId: 'name', status: 'active' })).records
    ).toHaveLength(1);
    expect(value(await ports.agents.listAgents())[0]?.displayName).toBe('After');
  });

  it('round-trips actual authority, history, revisions, branching and lifecycle', async () => {
    const { ports } = await host();
    const created = value(
      await ports.agents.createAgent({ identity: { agentId: 'wire', displayName: 'Wire' }, config })
    );
    expect(value(await ports.agents.listAgents())).toHaveLength(1);
    value(
      await ports.agents.updateAgentConfig({
        agentId: 'wire',
        expectedRevision: created.config.revision,
        config: { ...config, instructions: 'New instructions' },
      })
    );
    expect(
      (
        await ports.agents.updateAgentConfig({
          agentId: 'wire',
          expectedRevision: created.config.revision,
          config,
        })
      ).status
    ).toBe('failed');
    const events: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'wire', interactionId: 'first', message: 'Hello' },
      collect(events)
    );
    const terminal = events.at(-1);
    if (terminal?.type !== 'completed') throw new Error(JSON.stringify(terminal));
    const target = { agentId: 'wire', sessionId: terminal.sessionId };
    const nav = value(await ports.sessions.inspectSessionNavigation(target));
    expect(
      value(
        await ports.conversations.readConversation({ ...target, branchId: nav.selectedBranchId })
      ).turns[0]
    ).toEqual(terminal.turn);
    const fork = value(
      await ports.conversations.forkSessionBranch({
        ...target,
        expectedRevision: nav.revision,
        sourceBranchId: nav.selectedBranchId,
        throughTurnId: terminal.turn.turnId,
        newBranchId: 'other',
      })
    );
    expect(fork.navigation.branches).toHaveLength(2);
    const details = value(await ports.sessions.inspectSession(target));
    const live: ConversationInteractionEvent[] = [];
    const replayInput = {
      agentId: 'wire',
      interactionId: 'replay',
      message: 'Replay me',
      session: {
        sessionId: terminal.sessionId,
        branchId: fork.navigation.selectedBranchId,
        navigationRevision: fork.navigation.revision,
      },
    };
    await ports.conversations.streamInteraction(replayInput, collect(live));
    const replay: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(replayInput, collect(replay));
    const state = replay.reduce(
      reduceInteractionEvent,
      createSubmittingInteraction({
        interactionId: 'replay',
        message: 'Replay me',
        timestamp: new Date().toISOString(),
      })
    );
    expect(state.status).toBe('completed');
    const named = value(
      await ports.sessions.renameSession({
        ...target,
        title: 'Transport Session',
        expectedRevision: details.metadataRevision,
      })
    );
    const retired = value(
      await ports.sessions.retireSession({ ...target, expectedRevision: named.metadataRevision })
    );
    expect(
      value(await ports.sessions.listSessions({ agentId: 'wire', status: 'retired' })).records[0]
        ?.title
    ).toBe('Transport Session');
    value(
      await ports.sessions.restoreSession({ ...target, expectedRevision: retired.metadataRevision })
    );
  });

  it('rejects unknown fields, forged origins, unknown operations and oversized input without exposing internals', async () => {
    const { origin } = await host();
    const post = (body: unknown, originHeader?: string) =>
      fetch(`${origin}/api/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(originHeader === undefined ? {} : { Origin: originHeader }),
        },
        body: JSON.stringify(body),
      });
    expect(
      (await post({ command: 'listAgents', input: {} }, 'https://attacker.invalid')).status
    ).toBe(403);
    for (const body of [
      { command: 'unknown', input: {} },
      { command: 'listAgents', input: { secret: 'sensitive' } },
      { command: 'listAgents', input: {}, extra: true },
    ]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('sensitive');
    }
    const oversized = await post({
      command: 'listAgents',
      input: { huge: 'x'.repeat(WEB_TRANSPORT_LIMITS.requestBytes) },
    });
    expect(oversized.status).toBe(400);
  });

  it('cancels actual Engine work on client disconnect and drains it at shutdown', async () => {
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const base = createOfflineWebEngine();
    const engine = defineActorEngine({
      ...base,
      id: 'transport.wait',
      interact: async ({ signal, emit }) => {
        await emit({ type: 'reasoning-delta', delta: 'Thinking' });
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        cancelled();
        signal.throwIfAborted();
        throw new Error('Unreachable');
      },
    });
    const { ports, close } = await host(engine);
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'cancel', displayName: 'Cancel' },
        config: engineConfig(engine.id),
      })
    );
    const controller = new AbortController();
    const events: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'cancel', interactionId: 'cancel', message: 'Wait', signal: controller.signal },
      (event) => {
        events.push(event);
        if (event.type === 'reasoning-delta') controller.abort();
        return Promise.resolve();
      }
    );
    await cancellation;
    expect(events.at(-1)?.type).toBe('cancelled');
    const drainage = close();
    expect(close()).toBe(drainage);
    await drainage;
  });

  it('rejects malformed results/events and truncated streams', async () => {
    expect(() => commands.inspectAgent.output.decode({ status: 'succeeded', value: {} })).toThrow();
    expect(() =>
      interactionEvent.decode({
        type: 'reasoning-delta',
        interactionId: 'x',
        delta: 'x',
        modelTurnIndex: 0,
      })
    ).toThrow();
    for (const lines of [
      [],
      [{ type: 'interaction-started', interactionId: 'x' }],
      [
        { type: 'interaction-started', interactionId: 'x' },
        { type: 'unknown', interactionId: 'x' },
      ],
    ]) {
      const ports = createHttpAgentWebPorts({
        fetch: () =>
          Promise.resolve(
            new Response(
              lines.map((line) => JSON.stringify(line)).join('\n') +
                (lines.length === 0 ? '' : '\n'),
              { headers: { 'Content-Type': 'application/x-ndjson' } }
            )
          ),
      });
      const events: ConversationInteractionEvent[] = [];
      await ports.conversations.streamInteraction(
        { agentId: 'x', interactionId: 'x', message: 'x' },
        collect(events)
      );
      expect(events.at(-1)?.type).toBe('failed');
    }
    const getter = Object.defineProperty({}, 'agentId', {
      enumerable: true,
      get: () => {
        throw new Error('Getter must not run');
      },
    });
    expect(() => commands.inspectAgent.input.decode(getter)).toThrow('transport payload');
  });

  it.each(['clean-eof', 'disconnect'] as const)(
    'qualifies a terminal frame only after %s',
    async (ending) => {
      const streamController = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
      const textAccepted = Promise.withResolvers<void>();
      const timestamp = '2026-02-01T00:00:00.000Z';
      const frames: ConversationInteractionEvent[] = [
        { type: 'interaction-started', interactionId: 'x' },
        { type: 'text-delta', interactionId: 'x', modelTurnIndex: 1, delta: 'Answer' },
        {
          type: 'completed',
          interactionId: 'x',
          sessionId: 'session',
          turn: {
            status: 'completed',
            branchId: 'main',
            turnId: 'turn',
            userMessage: { text: 'Question', timestamp },
            assistantMessage: {
              text: 'Answer',
              timestamp,
              reasoningBlocks: [],
              toolActivities: [],
            },
          },
        },
      ];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController.resolve(controller);
          controller.enqueue(
            new TextEncoder().encode(frames.map((frame) => JSON.stringify(frame) + '\n').join(''))
          );
        },
      });
      const ports = createHttpAgentWebPorts({
        fetch: () =>
          Promise.resolve(
            new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
          ),
      });
      const events: ConversationInteractionEvent[] = [];
      const running = ports.conversations.streamInteraction(
        { agentId: 'x', interactionId: 'x', message: 'Question' },
        (event) => {
          events.push(event);
          if (event.type === 'text-delta') textAccepted.resolve();
          return Promise.resolve();
        }
      );
      try {
        await textAccepted.promise;
        expect(events.some((event) => event.type === 'completed')).toBe(false);
      } finally {
        const controller = await streamController.promise;
        if (ending === 'clean-eof') controller.close();
        else controller.error(new Error('Connection interrupted after terminal frame.'));
        await running;
      }
      expect(events.at(-1)?.type).toBe(ending === 'clean-eof' ? 'completed' : 'failed');
      if (ending === 'disconnect')
        expect(events.some((event) => event.type === 'completed')).toBe(false);
    }
  );

  it('runs real Pi parser, multi-turn tool loop and readable reasoning through localhost transport', async () => {
    const fixture = await providerServer();
    cleanup.push(fixture.close);
    const tools = createToolRegistry([
      defineTool({
        name: 'lookup',
        description: 'Lookup',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        execute: () => Promise.resolve({ text: 'private tool result' }),
      }),
    ]);
    const backend = createAgentBaseWebPorts({
      persistence: { kind: 'memory' },
      tools,
      toolLabels: { lookup: 'Safe lookup' },
    });
    const server = await startLocalAgentWebServer({ ports: backend });
    cleanup.push(server.close);
    const ports = createHttpAgentWebPorts({ baseUrl: `${server.origin}/api` });
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'pi', displayName: 'Pi-backed' },
        config: providerConfig(fixture.baseUrl),
      })
    );
    const events: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'pi', interactionId: 'pi', message: 'Use lookup' },
      collect(events)
    );
    const terminal = events.at(-1);
    if (terminal?.type !== 'completed') throw new Error(JSON.stringify(terminal));
    expect(fixture.requests).toHaveLength(2);
    expect(terminal.turn.assistantMessage.text).toBe('Final answer');
    expect(terminal.turn.assistantMessage.reasoningBlocks).toEqual([
      { modelTurnIndex: 1, text: 'Before tool' },
      { modelTurnIndex: 2, text: 'After tool' },
    ]);
    expect(terminal.turn.assistantMessage.toolActivities[0]?.status).toBe('success');
    expect(JSON.stringify(events)).not.toContain('private tool result');
    expect(JSON.stringify(fixture.requests[0])).toContain('"role":"system"');
  });
});
