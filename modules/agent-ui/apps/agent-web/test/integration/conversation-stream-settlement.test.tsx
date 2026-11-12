import type { ConversationInteractionEvent } from '@print-an-agent/ui-contracts';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { historyTurns } from '@print-an-agent/ui-workspace/testing';
import {
  cleanupConversationControllers,
  completeInteraction,
  completedTurn,
  conversationPorts,
  flushConversation,
  mountConversationController,
  readySession,
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

function input(management: ReturnType<typeof conversationPorts>) {
  return {
    agentId: 'agent-a',
    management,
    onConversationCommitted: vi.fn(),
    onInteractionSettled: vi.fn(),
    onNavigationChanged: vi.fn(),
    sessionState: readySession(),
  };
}

describe('interaction completion qualification', () => {
  it.each(['agent', 'session', 'branch', 'revision'] as const)(
    'locks protocol failure when admission changes the requested %s',
    async (violation) => {
      const selected = readySession();
      if (selected.status !== 'ready') throw new Error('Fixture Session is unavailable');
      const options = input(
        conversationPorts({
          streamInteraction: async (request, consume) => {
            await consume({ type: 'interaction-started', interactionId: request.interactionId });
            const patch = {
              ...(violation === 'agent' ? { agentId: 'other-agent' } : {}),
              ...(violation === 'session' ? { sessionId: 'other-session' } : {}),
              ...(violation === 'branch' ? { selectedBranchId: 'other-branch' } : {}),
            };
            await expect(
              consume({
                type: 'session-admitted',
                interactionId: request.interactionId,
                admission: {
                  details: { ...selected.details, ...patch },
                  navigation: {
                    ...selected.navigation,
                    ...patch,
                    ...(violation === 'revision' ? { revision: 'other-revision' } : {}),
                  },
                },
              })
            ).rejects.toThrow(
              'Session admission does not match the requested conversation target.'
            );
            // A custom port cannot recover by swallowing the consumer rejection and emitting more.
            await expect(
              consume({
                type: 'text-delta',
                interactionId: request.interactionId,
                modelTurnIndex: 1,
                delta: 'Untrusted output',
              })
            ).rejects.toThrow();
          },
        })
      );
      const view = mountConversationController(options);
      await flushConversation();
      act(() => view.controller.setComposerValue('Question'));
      await act(async () => view.controller.send());
      expect(view.controller.activeInteraction).toMatchObject({
        failure: { code: 'invalid-stream' },
        status: 'failed',
        admission: undefined,
      });
      expect(view.container.textContent).not.toContain('Untrusted output');
      expect(historyTurns(view.controller.historyState)).toHaveLength(1);
      expect(options.onConversationCommitted).not.toHaveBeenCalled();
    }
  );

  it('keeps completion provisional until the port settles', async () => {
    const completionReceived = Promise.withResolvers<void>();
    const settlement = Promise.withResolvers<void>();
    const options = input(
      conversationPorts({
        streamInteraction: async (request, consume) => {
          await completeInteraction(request, consume);
          completionReceived.resolve();
          await settlement.promise;
        },
      })
    );
    const view = mountConversationController(options);
    await flushConversation();
    act(() => view.controller.setComposerValue('Question'));
    let sending: Promise<void> | undefined;
    await act(async () => {
      sending = view.controller.send();
      await completionReceived.promise;
    });
    try {
      expect(view.controller.activeInteraction?.status).toBe('streaming');
      expect(historyTurns(view.controller.historyState)).toHaveLength(1);
      expect(options.onConversationCommitted).not.toHaveBeenCalled();
      expect(options.onInteractionSettled).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        settlement.resolve();
        await sending;
      });
    }
    expect(historyTurns(view.controller.historyState)).toHaveLength(2);
    expect(options.onConversationCommitted).toHaveBeenCalledOnce();
    expect(options.onInteractionSettled).toHaveBeenCalledOnce();
  });

  it('rejects port failure after completed without committing successful history', async () => {
    const options = input(
      conversationPorts({
        streamInteraction: async (request, consume) => {
          await completeInteraction(request, consume);
          throw new Error('Stream did not settle successfully.');
        },
      })
    );
    const view = mountConversationController(options);
    await flushConversation();
    act(() => view.controller.setComposerValue('Question'));
    await act(async () => view.controller.send());
    expect(view.controller.activeInteraction).toMatchObject({
      failure: { code: 'invalid-stream' },
      status: 'failed',
    });
    expect(view.container.textContent).toContain('New answer');
    expect(historyTurns(view.controller.historyState).map((turn) => turn.turnId)).toEqual([
      'initial',
    ]);
    expect(options.onConversationCommitted).not.toHaveBeenCalled();
    expect(options.onInteractionSettled).toHaveBeenCalledOnce();
  });

  it.each(['late-delta', 'duplicate-terminal', 'trailing-data'] as const)(
    'fails closed through the HTTP adapter and controller for %s after completed',
    async (violation) => {
      const ports = createHttpAgentWebPorts({
        fetch: (_url, request) => {
          if (typeof request?.body !== 'string') throw new Error('Expected interaction payload.');
          const payload: unknown = JSON.parse(request.body);
          if (
            typeof payload !== 'object' ||
            payload === null ||
            !('interactionId' in payload) ||
            typeof payload.interactionId !== 'string'
          )
            throw new Error('Expected interaction identity.');
          const interactionId = payload.interactionId;
          const terminal: ConversationInteractionEvent = {
            interactionId,
            sessionId: 'shared-session',
            turn: completedTurn('candidate'),
            type: 'completed',
          };
          const lines: ConversationInteractionEvent[] = [
            { interactionId, type: 'interaction-started' },
            { delta: 'New answer', interactionId, modelTurnIndex: 1, type: 'text-delta' },
            terminal,
          ];
          if (violation === 'late-delta') {
            lines.push({ delta: 'late', interactionId, modelTurnIndex: 1, type: 'text-delta' });
          } else if (violation === 'duplicate-terminal') {
            lines.push(terminal);
          }
          return Promise.resolve(
            new Response(
              lines.map((line) => JSON.stringify(line) + '\n').join('') +
                (violation === 'trailing-data' ? '{' : ''),
              { headers: { 'Content-Type': 'application/x-ndjson' } }
            )
          );
        },
      });
      const options = input(
        conversationPorts({
          streamInteraction: (request, consume) =>
            ports.conversations.streamInteraction(request, consume),
        })
      );
      const view = mountConversationController(options);
      await flushConversation();
      act(() => view.controller.setComposerValue('Question'));
      await act(async () => view.controller.send());
      expect(view.controller.activeInteraction).toMatchObject({
        failure: { code: 'invalid-stream' },
        status: 'failed',
      });
      expect(view.container.textContent).toContain('New answer');
      expect(view.container.textContent).not.toContain('late');
      expect(historyTurns(view.controller.historyState)).toHaveLength(1);
      expect(options.onConversationCommitted).not.toHaveBeenCalled();
    }
  );
});
