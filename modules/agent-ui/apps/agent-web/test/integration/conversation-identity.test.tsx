import type {
  ConversationInteractionEvent,
  StartConversationInteractionInput,
} from '@ta-agent/ui-contracts';
import { defineActorEngine } from '@ta-agent/model-invocation-core';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { engineConfig } from '../support/agent-config.js';
import {
  cleanupConversationControllers,
  flushConversation,
  mountConversationController,
} from '../support/conversation-controller.js';

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(cleanupConversationControllers);
afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

function value<T>(
  result: { status: 'succeeded'; value: T } | { status: 'failed'; failure: unknown }
): T {
  if (result.status === 'failed') throw new Error(JSON.stringify(result.failure));
  return result.value;
}

describe('logical interaction identity', () => {
  it('uses independent journal keys after remount and across mounted clients, preserving explicit replay', async () => {
    const offline = createOfflineWebEngine();
    const offlineInteract = offline.interact;
    if (offlineInteract === undefined) throw new Error('Expected offline interaction handler.');
    const interact = vi.fn(offlineInteract);
    const ports = createAgentBaseWebPorts({
      engine: defineActorEngine({ ...offline, interact }),
      persistence: { kind: 'memory' },
    });
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'identity', displayName: 'Identity' },
        config: engineConfig(),
      })
    );
    const seed: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'identity', interactionId: 'seed', message: 'Initial' },
      (event) => {
        seed.push(event);
        return Promise.resolve();
      }
    );
    const terminal = seed.at(-1);
    if (terminal?.type !== 'completed') throw new Error('Expected seed completion.');
    const target = { agentId: 'identity', sessionId: terminal.sessionId };
    const requests: StartConversationInteractionInput[] = [];
    const management = {
      ...ports.conversations,
      streamInteraction: (
        input: StartConversationInteractionInput,
        consume: Parameters<typeof ports.conversations.streamInteraction>[1]
      ) => {
        requests.push(input);
        return ports.conversations.streamInteraction(input, consume);
      },
    };
    const currentInput = async (): Promise<Parameters<typeof mountConversationController>[0]> => ({
      agentId: target.agentId,
      management,
      onConversationCommitted: vi.fn(),
      onInteractionSettled: vi.fn(),
      onNavigationChanged: vi.fn(),
      sessionState: {
        status: 'ready',
        details: value(await ports.sessions.inspectSession(target)),
        navigation: value(await ports.sessions.inspectSessionNavigation(target)),
      },
    });
    const mount = async () => {
      const view = mountConversationController(await currentInput());
      await flushConversation();
      return view;
    };
    const send = async (view: Awaited<ReturnType<typeof mount>>, text = 'Question') => {
      // A different client may advance navigation; keep CAS authority independent from ID tests.
      view.render(await currentInput());
      await flushConversation();
      act(() => view.controller.setComposerValue(text));
      await act(async () => view.controller.send());
      expect(view.controller.activeInteraction).toBeUndefined();
    };

    await send(await mount());
    cleanupConversationControllers();
    const refreshed = await mount();
    await send(refreshed);
    const secondTab = await mount();
    await send(secondTab, 'A different question');
    await send(refreshed);

    expect(requests).toHaveLength(4);
    expect(new Set(requests.map((request) => request.interactionId)).size).toBe(4);
    for (const request of requests) {
      expect(request.interactionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      );
    }
    expect(interact).toHaveBeenCalledTimes(5);
    const history = value(
      await ports.conversations.readConversation({ ...target, branchId: terminal.turn.branchId })
    );
    expect(history.turns.map((turn) => turn.userMessage.text)).toEqual([
      'Initial',
      'Question',
      'Question',
      'A different question',
      'Question',
    ]);

    const original = requests[0];
    if (original === undefined) throw new Error('Expected original request.');
    const replay: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { ...original, signal: new AbortController().signal },
      (event) => {
        replay.push(event);
        return Promise.resolve();
      }
    );
    expect(replay.at(-1)).toMatchObject({ type: 'completed', turn: history.turns[1] });
    expect(interact).toHaveBeenCalledTimes(5);
  });
});
