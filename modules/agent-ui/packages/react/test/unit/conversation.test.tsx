import type { CompletedConversationTurn } from '@ta-agent/ui-contracts';
import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ConversationComposer,
  ConversationScrollRegion,
  ConversationTimeline,
  ConversationTurn,
  type ConversationTurnLabels,
} from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

const LABELS: ConversationTurnLabels = Object.freeze({
  assistant: 'Assistant',
  reasoning: (index: number) => `Thinking ${String(index)}`,
  reasoningStates: Object.freeze({
    completed: 'Complete',
    incomplete: 'Incomplete',
    streaming: 'In progress',
  }),
  states: Object.freeze({
    cancelled: 'Cancelled',
    cancelling: 'Cancelling',
    completed: 'Completed',
    committed: 'Saved · presentation needs recovery',
    failed: 'Failed',
    streaming: 'Responding',
    submitting: 'Starting',
  }),
  toolDetails: 'Details',
  tools: Object.freeze({
    error: 'Failed',
    interrupted: 'Interrupted',
    pending: 'Running',
    success: 'Complete',
  }),
  user: 'You',
});

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

describe('conversation components', () => {
  it('renders a continuous user/assistant message sequence without an exchange card or completed banner', () => {
    const turn = completedTurn();
    const markup = renderToStaticMarkup(
      <ConversationTimeline
        emptyTitle="No messages"
        loadMoreLabel="Older"
        loadingLabel="Loading"
        retryLabel="Retry"
      >
        {[1, 2].map((index) => (
          <ConversationTurn
            key={index}
            assistantText={`Answer ${index}`}
            labels={LABELS}
            actions={<button type="button">Fork</button>}
            state="completed"
            userMessage={{ ...turn.userMessage, text: `Question ${index}` }}
          />
        ))}
      </ConversationTimeline>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    expect(
      [
        ...container.querySelectorAll(
          '[data-slot="user-message"], [data-slot="assistant-message"]'
        ),
      ].map((node) => node.getAttribute('data-role'))
    ).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(container.querySelector('[data-slot="conversation-turn"] > article')).toBeNull();
    expect(container.querySelector('.ta-ui-conversation-turn__header')).toBeNull();
    expect(
      container.querySelectorAll(
        '[data-slot="conversation-response"] .ta-ui-conversation-turn__actions'
      )
    ).toHaveLength(2);
    expect(markup).not.toContain('style=');
  });
  it('keeps assistant, model-turn reasoning, and safe tool presentation structurally separate', () => {
    const turn = completedTurn();
    const markup = renderToStaticMarkup(
      <ol>
        <ConversationTurn
          assistantText={turn.assistantMessage.text}
          labels={LABELS}
          reasoningBlocks={turn.assistantMessage.reasoningBlocks}
          state="completed"
          toolActivities={turn.assistantMessage.toolActivities}
          userMessage={turn.userMessage}
        />
      </ol>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.querySelectorAll('[data-slot="reasoning-block"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="assistant-message"]')).toHaveLength(1);
    expect(container.querySelector('[data-slot="assistant-message"]')?.textContent).toContain(
      'Final answer'
    );
    expect(container.querySelector('[data-slot="tool-activity"]')?.textContent).toContain(
      'Evidence lookup'
    );
    expect(container.textContent).not.toContain('rawArguments');
    expect(markup).not.toContain('style=');
  });

  it('shows an empty timeline when conditional children are null', () => {
    const markup = renderToStaticMarkup(
      <ConversationTimeline
        emptyTitle="No turns"
        loadMoreLabel="Older"
        loadingLabel="Loading"
        retryLabel="Retry"
      >
        {null}
      </ConversationTimeline>
    );
    expect(markup).toContain('No turns');
    expect(markup).not.toContain('conversation-timeline__list');
  });

  it('keeps existing turns visible beside loading and failure boundaries', () => {
    const loadingMarkup = renderToStaticMarkup(
      <ConversationTimeline
        emptyTitle="No turns"
        loadMoreLabel="Older"
        loading
        loadingLabel="Loading history"
        retryLabel="Retry"
      >
        <li>Streaming turn</li>
      </ConversationTimeline>
    );
    expect(loadingMarkup).toContain('Loading history');
    expect(loadingMarkup).toContain('Streaming turn');

    const failedMarkup = renderToStaticMarkup(
      <ConversationTimeline
        emptyTitle="No turns"
        error="History unavailable"
        loadMoreLabel="Older"
        loadingLabel="Loading history"
        retryLabel="Retry"
      >
        <li>Failed partial turn</li>
      </ConversationTimeline>
    );
    expect(failedMarkup).toContain('History unavailable');
    expect(failedMarkup).toContain('Failed partial turn');
  });

  it('presents a pending tool as interrupted after its parent turn terminates', () => {
    const markup = renderToStaticMarkup(
      <ol>
        <ConversationTurn
          labels={LABELS}
          state="cancelled"
          toolActivities={[
            {
              callId: 'tool-pending',
              details: [],
              modelTurnIndex: 1,
              status: 'pending',
              toolLabel: 'Evidence lookup',
            },
          ]}
          userMessage={{ text: 'Stop this tool', timestamp: '2026-02-01T00:00:00.000Z' }}
        />
      </ol>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const activity = container.querySelector('[data-slot="tool-activity"]');
    expect(activity?.getAttribute('data-status')).toBe('interrupted');
    expect(activity?.textContent).toContain('Interrupted');
    expect(activity?.textContent).not.toContain('Running');
  });

  it('submits Enter, preserves Shift+Enter, and exposes explicit cancellation', () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const container = renderInDocument(
      <ConversationComposer
        cancelLabel="Cancel"
        inputLabel="Message"
        onCancel={onCancel}
        onSubmit={onSubmit}
        onValueChange={() => undefined}
        sendLabel="Send"
        state="streaming"
        value="Question"
      />
    );
    act(() =>
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Cancel')
        ?.click()
    );
    expect(onCancel).toHaveBeenCalledOnce();

    cleanupReactRoots();
    const idle = renderInDocument(
      <ConversationComposer
        cancelLabel="Cancel"
        inputLabel="Message"
        onSubmit={onSubmit}
        onValueChange={() => undefined}
        sendLabel="Send"
        value="Question"
      />
    );
    const textarea = idle.querySelector('textarea');
    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', shiftKey: true })
      );
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('stops following when the reader scrolls away and offers an explicit jump to latest', () => {
    const container = renderInDocument(<ConversationScrollHarness />);
    const region = container.querySelector<HTMLDivElement>(
      '[data-slot="conversation-scroll-region"]'
    );
    if (region === null) throw new Error('Expected conversation scroll region.');
    Object.defineProperties(region, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 800 },
    });
    region.scrollTop = 100;
    act(() => {
      region.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(region.getAttribute('data-following')).toBeNull();

    act(() => container.querySelector<HTMLButtonElement>('[data-switch-conversation]')?.click());
    expect(region.getAttribute('data-following')).toBe('true');
    expect(region.scrollTop).toBe(800);

    region.scrollTop = 100;
    act(() => {
      region.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    act(() =>
      [...region.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Latest')
        ?.click()
    );
    expect(region.getAttribute('data-following')).toBe('true');
    expect(region.scrollTop).toBe(800);
  });
});

function ConversationScrollHarness() {
  const [conversationKey, setConversationKey] = useState('conversation-one');
  return (
    <>
      <button
        data-switch-conversation
        onClick={() => setConversationKey('conversation-two')}
        type="button"
      >
        Switch conversation
      </button>
      <ConversationScrollRegion
        aria-label="Conversation"
        contentRevision="one"
        conversationKey={conversationKey}
        jumpToLatestLabel="Latest"
      >
        Content
      </ConversationScrollRegion>
    </>
  );
}

function completedTurn(): CompletedConversationTurn {
  return Object.freeze({
    assistantMessage: Object.freeze({
      reasoningBlocks: Object.freeze([
        Object.freeze({ modelTurnIndex: 1, text: 'Before tool' }),
        Object.freeze({ modelTurnIndex: 2, text: 'After tool' }),
      ]),
      text: 'Final answer',
      timestamp: '2026-02-01T00:00:01.000Z',
      toolActivities: Object.freeze([
        Object.freeze({
          callId: 'tool-1',
          details: Object.freeze([Object.freeze({ label: 'Matches', value: '2' })]),
          modelTurnIndex: 1,
          status: 'success',
          summary: 'Two safe records.',
          toolLabel: 'Evidence lookup',
        }),
      ]),
    }),
    branchId: 'main',
    status: 'completed',
    turnId: 'turn-1',
    userMessage: Object.freeze({
      text: 'Use a tool',
      timestamp: '2026-02-01T00:00:00.000Z',
    }),
  });
}
