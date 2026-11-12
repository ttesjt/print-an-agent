import type {
  ForkSessionBranchInput,
  RewindSessionBranchInput,
} from '@print-an-agent/ui-contracts';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cleanupConversationControllers,
  completedTurn,
  conversationPorts,
  flushConversation,
  mountConversationController,
  readySession,
} from '../support/conversation-controller.js';

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(cleanupConversationControllers);
afterAll(() => {
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});

function mount() {
  const turn = completedTurn('initial', 'Final answer', 'Question');
  const defaults = conversationPorts();
  const fork = vi.fn((request: ForkSessionBranchInput) => defaults.forkSessionBranch(request));
  const rewind = vi.fn((request: RewindSessionBranchInput) =>
    defaults.rewindSessionBranch(request)
  );
  const management = conversationPorts({
    forkSessionBranch: fork,
    rewindSessionBranch: rewind,
    readConversation: () =>
      Promise.resolve({
        status: 'succeeded',
        value: {
          turns: [
            {
              ...turn,
              assistantMessage: {
                ...turn.assistantMessage,
                reasoningBlocks: [
                  { modelTurnIndex: 1, text: 'Before tool' },
                  { modelTurnIndex: 2, text: 'After tool' },
                ],
              },
            },
          ],
        },
      }),
  });
  const view = mountConversationController({
    agentId: 'agent-a',
    management,
    onConversationCommitted: vi.fn(),
    onInteractionSettled: vi.fn(),
    onNavigationChanged: vi.fn(),
    sessionState: readySession(),
  });
  return { ...view, fork, rewind };
}

function button(container: ParentNode, label: string) {
  const result = [...container.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label
  );
  if (result === undefined) throw new Error(`Missing ${label}`);
  return result;
}

describe('quiet Agent Web transcript', () => {
  it('keeps reasoning stages distinct and places routine metadata in a focusable tooltip', async () => {
    const view = mount();
    await flushConversation();
    const blocks = [...view.container.querySelectorAll('[data-slot="reasoning-block"]')];
    expect(blocks.map((block) => block.getAttribute('data-model-turn-index'))).toEqual(['1', '2']);
    expect(blocks.map((block) => block.querySelector('summary')?.textContent)).toEqual([
      'Thought process · stage 1',
      'Thought process · stage 2',
    ]);
    expect(blocks.every((block) => block.querySelector('details')?.open === false)).toBe(true);
    expect(view.container.querySelector('[data-slot="assistant-message"] header')).toBeNull();
    expect(view.container.querySelector('[data-slot="user-message"] time')).toBeNull();
    const actions = view.container.querySelector('[data-conversation-turn-actions]');
    if (actions === null) throw new Error('Missing message actions');
    const tooltip = actions.querySelector<HTMLDivElement>('[role="tooltip"]');
    const trigger = actions.querySelector<HTMLButtonElement>('[aria-label="Message timestamps"]');
    expect(tooltip?.hidden).toBe(true);
    expect(tooltip?.querySelectorAll('time')).toHaveLength(2);
    expect(actions.querySelector('details')).toBeNull();
    expect(
      blocks.every(
        (block) =>
          block
            .querySelector('[data-slot="disclosure-panel"]')
            ?.getAttribute('data-content-max-height') === 'medium'
      )
    ).toBe(true);
    act(() => trigger?.focus());
    expect(tooltip?.hidden).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(tooltip?.textContent).toContain('Answered');
    expect(view.fork).not.toHaveBeenCalled();
    expect(view.rewind).not.toHaveBeenCalled();
  });

  it('keeps Fork visible and focusable while Rewind retains application-owned confirmation', async () => {
    const view = mount();
    await flushConversation();
    const actions = view.container.querySelector('[data-conversation-turn-actions]');
    if (actions === null) throw new Error('Missing message actions');
    const forkButton = button(actions, 'Fork from here');
    act(() => forkButton.focus());
    expect(document.activeElement).toBe(forkButton);
    expect(forkButton.getAttribute('data-appearance')).toBe('ghost');
    act(() => forkButton.click());
    await flushConversation();
    expect(view.fork).toHaveBeenCalledOnce();
    expect(view.fork.mock.calls[0]?.[0]).toMatchObject({
      agentId: 'agent-a',
      sessionId: 'shared-session',
      throughTurnId: 'initial',
    });
    act(() => button(actions, 'Rewind to here').click());
    expect(view.rewind).not.toHaveBeenCalled();
    const confirmation = document.querySelector('dialog[open]');
    if (confirmation === null) throw new Error('Missing Rewind confirmation');
    act(() => button(confirmation, 'Create rewind branch').click());
    await flushConversation();
    expect(view.rewind).toHaveBeenCalledOnce();
  });

  it.each(['persisted', 'draft'] as const)(
    'keeps a reader-expanded live block open after %s completion and history reconciliation',
    async (targetKind) => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const committed = vi.fn();
      let persisted = false;
      const turn = {
        ...completedTurn('new-turn', 'Final answer', 'Question'),
        assistantMessage: {
          ...completedTurn('new-turn', 'Final answer').assistantMessage,
          reasoningBlocks: [{ modelTurnIndex: 1, text: 'Live reasoning' }],
        },
      };
      const management = conversationPorts({
        readConversation: () =>
          Promise.resolve({ status: 'succeeded', value: { turns: persisted ? [turn] : [] } }),
        streamInteraction: async (request, consume) => {
          await consume({ interactionId: request.interactionId, type: 'interaction-started' });
          await consume({
            delta: 'Live reasoning',
            interactionId: request.interactionId,
            modelTurnIndex: 1,
            type: 'reasoning-delta',
          });
          started.resolve();
          await release.promise;
          await consume({
            delta: 'Final answer',
            interactionId: request.interactionId,
            modelTurnIndex: 1,
            type: 'text-delta',
          });
          persisted = true;
          await consume({
            interactionId: request.interactionId,
            sessionId: 'shared-session',
            turn,
            type: 'completed',
          });
        },
      });
      const options = {
        agentId: 'agent-a',
        management,
        onConversationCommitted: committed,
        onInteractionSettled: vi.fn(),
        onNavigationChanged: vi.fn(),
        sessionState:
          targetKind === 'persisted'
            ? readySession()
            : { draftId: 'presentation-draft', status: 'draft' as const },
      };
      const view = mountConversationController(options);
      await flushConversation();
      act(() => view.controller.setComposerValue('Question'));
      let sending: Promise<void> | undefined;
      await act(async () => {
        sending = view.controller.send();
        await started.promise;
      });
      try {
        expect(view.container.querySelector('[data-conversation-turn-actions]')).toBeNull();
        const live = view.container.querySelector<HTMLDetailsElement>(
          '[data-slot="reasoning-block"] details'
        );
        if (live === null) throw new Error('Missing live block');
        expect(live.open).toBe(false);
        act(() => live.querySelector('summary')?.click());
        expect(live.open).toBe(true);
      } finally {
        await act(async () => {
          release.resolve();
          await sending;
        });
      }
      expect(committed).toHaveBeenCalledOnce();
      if (targetKind === 'draft') {
        view.render({ ...options, sessionState: readySession() });
      }
      await flushConversation();
      expect(view.container.querySelector('[data-conversation-turn-actions]')).not.toBeNull();
      const saved = view.container.querySelector<HTMLDetailsElement>(
        '[data-slot="reasoning-block"] details'
      );
      expect(saved?.open).toBe(true);
      expect(
        view.container.querySelector('[data-slot="reasoning-block"]')?.getAttribute('data-state')
      ).toBe('completed');
      act(() => view.controller.refreshHistory());
      await flushConversation();
      // Authoritative reloading replaces the view model, not the reader's ephemeral choice.
      expect(
        view.container.querySelector<HTMLDetailsElement>('[data-slot="reasoning-block"] details')
          ?.open
      ).toBe(true);
    }
  );

  it('does not project a persisted failed Turn as a successfully answered action surface', async () => {
    const view = mountConversationController({
      agentId: 'agent-a',
      management: conversationPorts({
        readConversation: () =>
          Promise.resolve({
            status: 'succeeded',
            value: {
              turns: [
                {
                  branchId: 'main',
                  turnId: 'failed-turn',
                  status: 'failed',
                  userMessage: {
                    text: 'Unanswered question',
                    timestamp: '2026-02-01T12:00:00.000Z',
                  },
                  failure: { code: 'interaction-failed', message: 'The saved Turn failed.' },
                },
              ],
            },
          }),
      }),
      onConversationCommitted: vi.fn(),
      onInteractionSettled: vi.fn(),
      onNavigationChanged: vi.fn(),
      sessionState: readySession(),
    });
    await flushConversation();
    expect(view.container.textContent).toContain('The saved Turn failed.');
    expect(view.container.querySelector('[data-conversation-turn-actions]')).toBeNull();
    expect(view.container.querySelector('time')).toBeNull();
  });

  it.each(['succeeded', 'protocol-failed'] as const)(
    'waits for stream settlement before exposing completed actions (%s)',
    async (outcome) => {
      const provisional = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const committed = vi.fn();
      const management = conversationPorts({
        readConversation: () => Promise.resolve({ status: 'succeeded', value: { turns: [] } }),
        streamInteraction: async (request, consume) => {
          await consume({ interactionId: request.interactionId, type: 'interaction-started' });
          await consume({
            delta: 'Answer',
            interactionId: request.interactionId,
            modelTurnIndex: 1,
            type: 'text-delta',
          });
          await consume({
            interactionId: request.interactionId,
            sessionId: 'shared-session',
            turn: completedTurn('new-turn', 'Answer'),
            type: 'completed',
          });
          provisional.resolve();
          await release.promise;
          if (outcome === 'protocol-failed') {
            await consume({
              delta: 'Illegal late output',
              interactionId: request.interactionId,
              modelTurnIndex: 1,
              type: 'text-delta',
            });
          }
        },
      });
      const view = mountConversationController({
        agentId: 'agent-a',
        management,
        onConversationCommitted: committed,
        onInteractionSettled: vi.fn(),
        onNavigationChanged: vi.fn(),
        sessionState: readySession(),
      });
      await flushConversation();
      act(() => view.controller.setComposerValue('Question'));
      let sending: Promise<void> | undefined;
      await act(async () => {
        sending = view.controller.send();
        await provisional.promise;
      });
      try {
        expect(view.container.textContent).toContain('Answer');
        expect(view.container.querySelector('[data-conversation-turn-actions]')).toBeNull();
        expect(committed).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          release.resolve();
          await sending;
        });
      }
      expect(view.container.querySelector('[data-conversation-turn-actions]') !== null).toBe(
        outcome === 'succeeded'
      );
      expect(committed).toHaveBeenCalledTimes(outcome === 'succeeded' ? 1 : 0);
      if (outcome === 'protocol-failed') {
        expect(
          view.container
            .querySelector('[data-slot="conversation-turn"]')
            ?.getAttribute('data-state')
        ).toBe('failed');
      }
    }
  );

  it.each(['failed', 'cancelled'] as const)(
    'keeps partial %s output without success-only commands or answered metadata',
    async (outcome) => {
      const view = mountConversationController({
        agentId: 'agent-a',
        management: conversationPorts({
          readConversation: () => Promise.resolve({ status: 'succeeded', value: { turns: [] } }),
          streamInteraction: async (request, consume) => {
            await consume({ interactionId: request.interactionId, type: 'interaction-started' });
            await consume({
              delta: 'Partial answer',
              interactionId: request.interactionId,
              modelTurnIndex: 1,
              type: 'text-delta',
            });
            await consume(
              outcome === 'cancelled'
                ? { interactionId: request.interactionId, type: 'cancelled' }
                : {
                    interactionId: request.interactionId,
                    type: 'failed',
                    failure: {
                      code: 'interaction-failed',
                      message: 'Provider failed.',
                    },
                  }
            );
          },
        }),
        onConversationCommitted: vi.fn(),
        onInteractionSettled: vi.fn(),
        onNavigationChanged: vi.fn(),
        sessionState: readySession(),
      });
      await flushConversation();
      act(() => view.controller.setComposerValue('Question'));
      await act(() => view.controller.send());
      expect(view.container.textContent).toContain('Partial answer');
      expect(view.container.querySelector('[data-conversation-turn-actions]')).toBeNull();
      expect(
        view.container.querySelector('[data-slot="conversation-turn"]')?.getAttribute('data-state')
      ).toBe(outcome);
    }
  );
});
