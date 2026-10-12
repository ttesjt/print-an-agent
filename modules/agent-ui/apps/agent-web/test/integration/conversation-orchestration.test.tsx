import type {
  ConversationPage,
  ConversationResult,
  SessionBranchMutationResult,
  SessionManagementResult,
  StartConversationInteractionInput,
} from '@ta-agent/ui-contracts';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ConversationManagementPort } from '../../src/application/ports.js';
import { historyTurns } from '@ta-agent/ui-workspace/testing';
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

function controllerInput(management: ConversationManagementPort, agentId = 'agent-a') {
  return {
    agentId,
    management,
    onConversationCommitted: vi.fn(),
    onInteractionSettled: vi.fn(),
    onNavigationChanged: vi.fn(),
    sessionState: readySession(agentId),
  };
}

describe('conversation history reconciliation', () => {
  it.each([false, true])(
    'preserves a committed turn when a delayed first page returns (overlap: %s)',
    async (overlap) => {
      const read = Promise.withResolvers<ConversationResult<ConversationPage>>();
      const view = mountConversationController(
        controllerInput(conversationPorts({ readConversation: () => read.promise }))
      );
      act(() => view.controller.setComposerValue('Question'));
      await act(async () => view.controller.send());

      expect(view.controller.historyState.status).toBe('loading');
      expect(view.container.textContent).toContain('New answer');
      const committed = historyTurns(view.controller.historyState)[0];
      if (committed === undefined) throw new Error('Expected the committed turn.');

      await act(async () => {
        read.resolve({
          status: 'succeeded',
          value: {
            turns: [completedTurn('initial', 'Old answer'), ...(overlap ? [committed] : [])],
          },
        });
        await Promise.resolve();
      });

      expect(historyTurns(view.controller.historyState).map((turn) => turn.turnId)).toEqual([
        'initial',
        committed.turnId,
      ]);
      expect(view.container.textContent).toContain('Old answer');
      expect(view.container.textContent).toContain('New answer');
    }
  );

  it.each(['failure', 'rejection'] as const)(
    'retains committed presentation when a delayed first page ends in %s',
    async (outcome) => {
      const read = Promise.withResolvers<ConversationResult<ConversationPage>>();
      const view = mountConversationController(
        controllerInput(conversationPorts({ readConversation: () => read.promise }))
      );
      act(() => view.controller.setComposerValue('Question'));
      await act(async () => view.controller.send());
      await act(async () => {
        if (outcome === 'rejection') read.reject(new Error('History unavailable'));
        else {
          read.resolve({
            failure: { code: 'operation-failed', message: 'History unavailable' },
            status: 'failed',
          });
        }
        await Promise.resolve();
      });

      expect(view.controller.historyState.status).toBe('failed');
      expect(view.container.textContent).toContain('History unavailable');
      expect(view.container.textContent).toContain('New answer');
      expect(
        view.container.querySelectorAll('[data-state="completed"][data-slot="conversation-turn"]')
      ).toHaveLength(1);
    }
  );

  it.each(['success', 'failure', 'rejection'] as const)(
    'merges a delayed older page with the current history on %s',
    async (outcome) => {
      const older = Promise.withResolvers<ConversationResult<ConversationPage>>();
      const recent = completedTurn('recent', 'Recent answer');
      const view = mountConversationController(
        controllerInput(
          conversationPorts({
            readConversation: (input) =>
              input.cursor === undefined
                ? Promise.resolve({
                    status: 'succeeded',
                    value: { nextCursor: 'older', turns: [recent] },
                  })
                : older.promise,
          })
        )
      );
      await flushConversation();
      let pagination: Promise<void> | undefined;
      act(() => {
        pagination = view.controller.loadMore();
      });
      act(() => view.controller.setComposerValue('Question'));
      await act(async () => view.controller.send());
      const committed = historyTurns(view.controller.historyState).at(-1);
      if (committed === undefined) throw new Error('Expected the committed turn.');
      await act(async () => {
        if (outcome === 'rejection') older.reject(new Error('Older history unavailable'));
        else if (outcome === 'failure') {
          older.resolve({
            failure: { code: 'operation-failed', message: 'Older history unavailable' },
            status: 'failed',
          });
        } else {
          older.resolve({
            status: 'succeeded',
            value: {
              nextCursor: 'oldest',
              turns: [completedTurn('older', 'Older answer'), recent],
            },
          });
        }
        await pagination;
      });

      const state = view.controller.historyState;
      expect(historyTurns(state).map((turn) => turn.turnId)).toEqual([
        ...(outcome === 'success' ? ['older'] : []),
        'recent',
        committed.turnId,
      ]);
      expect(state).toMatchObject({
        hasMore: true,
        nextCursor: outcome === 'success' ? 'oldest' : 'older',
        status: 'ready',
      });
      if (state.status !== 'ready') throw new Error('Expected ready history.');
      expect(state.loadingMore).not.toBe(true);
      if (outcome !== 'success') {
        expect(state.loadMoreError).toBe('Older history unavailable');
      }
      expect(view.container.textContent).toContain('New answer');
    }
  );

  it('refreshes the starting snapshot while retaining turns committed during the refresh', async () => {
    const refresh = Promise.withResolvers<ConversationResult<ConversationPage>>();
    let reads = 0;
    const view = mountConversationController(
      controllerInput(
        conversationPorts({
          readConversation: () =>
            ++reads === 1
              ? Promise.resolve({
                  status: 'succeeded',
                  value: { turns: [completedTurn('obsolete', 'Obsolete answer')] },
                })
              : refresh.promise,
        })
      )
    );
    await flushConversation();
    act(() => view.controller.refreshHistory());
    act(() => view.controller.setComposerValue('Question'));
    await act(async () => view.controller.send());
    const committed = historyTurns(view.controller.historyState).at(-1);
    if (committed === undefined) throw new Error('Expected the committed turn.');
    await act(async () => {
      refresh.resolve({
        status: 'succeeded',
        value: { turns: [completedTurn('canonical', 'Canonical answer')] },
      });
      await refresh.promise;
    });

    expect(historyTurns(view.controller.historyState).map((turn) => turn.turnId)).toEqual([
      'canonical',
      committed.turnId,
    ]);
  });
});

describe('conversation operation ownership', () => {
  it('keeps concurrent requests for the same older page single-flight', async () => {
    const older = Promise.withResolvers<ConversationResult<ConversationPage>>();
    const read = vi.fn<ConversationManagementPort['readConversation']>((input) =>
      input.cursor === undefined
        ? Promise.resolve({
            status: 'succeeded',
            value: { nextCursor: 'older', turns: [completedTurn('recent')] },
          })
        : older.promise
    );
    const view = mountConversationController(
      controllerInput(conversationPorts({ readConversation: read }))
    );
    await flushConversation();
    let requests: readonly Promise<void>[] = [];
    act(() => {
      requests = [view.controller.loadMore(), view.controller.loadMore()];
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {
      older.resolve({ status: 'succeeded', value: { turns: [completedTurn('older')] } });
      await Promise.all(requests);
    });
    expect(historyTurns(view.controller.historyState).map((turn) => turn.turnId)).toEqual([
      'older',
      'recent',
    ]);
  });

  it('rejects duplicate sends synchronously without cancelling the first interaction', async () => {
    const release = Promise.withResolvers<void>();
    const calls: StartConversationInteractionInput[] = [];
    const view = mountConversationController(
      controllerInput(
        conversationPorts({
          streamInteraction: async (input, consume) => {
            calls.push(input);
            await release.promise;
            await completeInteraction(input, consume);
          },
        })
      )
    );
    await flushConversation();
    act(() => view.controller.setComposerValue('Question'));
    let requests: readonly Promise<void>[] = [];
    act(() => {
      requests = [view.controller.send(), view.controller.send()];
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await act(async () => {
      release.resolve();
      await Promise.all(requests);
    });
    expect(historyTurns(view.controller.historyState)).toHaveLength(2);
  });

  it('holds the interaction slot until the accepted terminal stream finishes draining', async () => {
    const release = Promise.withResolvers<void>();
    const stream = vi.fn<ConversationManagementPort['streamInteraction']>(
      async (input, consume) => {
        await completeInteraction(input, consume);
        await release.promise;
      }
    );
    const view = mountConversationController(
      controllerInput(conversationPorts({ streamInteraction: stream }))
    );
    await flushConversation();
    act(() => view.controller.setComposerValue('Question'));
    let first: Promise<void> | undefined;
    act(() => {
      first = view.controller.send();
    });
    await flushConversation();
    expect(view.controller.activeInteraction?.status).toBe('streaming');
    act(() => view.controller.setComposerValue('Another question'));
    await act(async () => view.controller.send());
    expect(stream).toHaveBeenCalledTimes(1);
    await act(async () => {
      release.resolve();
      await first;
    });
    await act(async () => view.controller.send());
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it.each(['fork', 'rewind'] as const)(
    'keeps %s single-flight before React rerenders',
    async (operation) => {
      const release = Promise.withResolvers<SessionManagementResult<SessionBranchMutationResult>>();
      const mutate = vi.fn(() => release.promise);
      const view = mountConversationController(
        controllerInput(
          conversationPorts({
            forkSessionBranch: mutate,
            rewindSessionBranch: mutate,
          })
        )
      );
      await flushConversation();
      let requests: readonly Promise<void>[] = [];
      act(() => {
        const invoke =
          operation === 'fork' ? view.controller.forkFromTurn : view.controller.rewindToTurn;
        requests = [invoke('initial'), invoke('initial')];
      });
      expect(mutate).toHaveBeenCalledTimes(1);
      await act(async () => {
        release.resolve({
          status: 'failed',
          failure: { code: 'unavailable', message: 'Unavailable' },
        });
        await Promise.all(requests);
      });
      expect(view.controller.branchMutationTurnId).toBeUndefined();
    }
  );

  it('scopes working Session IDs to the selected Agent while retaining background Agent activity', async () => {
    const release = Promise.withResolvers<void>();
    const input = controllerInput(
      conversationPorts({
        streamInteraction: async (request, consume) => {
          await release.promise;
          await completeInteraction(request, consume);
        },
      })
    );
    const view = mountConversationController(input);
    await flushConversation();
    act(() => view.controller.setComposerValue('Question'));
    let running: Promise<void> | undefined;
    act(() => {
      running = view.controller.send();
    });
    expect(view.controller.workingSessionIds).toEqual(['shared-session']);

    view.render({ ...input, agentId: 'agent-b', sessionState: readySession('agent-b') });
    await flushConversation();
    expect(view.controller.workingAgentIds).toEqual(['agent-a']);
    expect(view.controller.workingSessionIds).toEqual([]);

    view.render(input);
    await flushConversation();
    expect(view.controller.workingSessionIds).toEqual(['shared-session']);
    await act(async () => {
      release.resolve();
      await running;
    });
  });
});
