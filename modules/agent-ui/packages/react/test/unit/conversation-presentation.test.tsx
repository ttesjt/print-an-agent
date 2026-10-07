import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AssistantMessage, ReasoningBlock, ToolActivity, UserMessage } from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

describe('quiet conversation presentation', () => {
  it('keeps message identity accessible without a visible header in compact presentation', () => {
    const container = renderInDocument(
      <>
        <UserMessage
          label="You"
          message={{ text: 'Question', timestamp: '2026-02-01T00:00:00Z' }}
        />
        <AssistantMessage label="Assistant" text="Answer" />
      </>
    );
    expect(container.querySelectorAll('[data-presentation="compact"]')).toHaveLength(2);
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('time')).toBeNull();
    expect(
      [...container.querySelectorAll('.ta-ui-visually-hidden')].map((label) => label.textContent)
    ).toEqual(['You', 'Assistant']);
    expect(container.querySelector('[data-role="assistant"]')?.textContent).toContain('Answer');
  });

  it('supports explicit detailed message metadata and caller-owned timestamp formatting', () => {
    const container = renderInDocument(
      <AssistantMessage
        formatTimestamp={(value) => `Formatted: ${value}`}
        label="Assistant"
        presentation="detailed"
        text="Answer"
        timestamp="2026-02-01T00:00:01Z"
      />
    );
    expect(container.querySelector('header')?.textContent).toContain('Assistant');
    expect(container.querySelector('time')?.dateTime).toBe('2026-02-01T00:00:01Z');
    expect(container.querySelector('time')?.textContent).toBe('Formatted: 2026-02-01T00:00:01Z');
  });

  it('keeps streaming reasoning collapsed until requested, then preserves reader choice across updates', () => {
    const container = renderInDocument(<ReasoningUpdates />);
    const details = container.querySelector('details');
    const summary = container.querySelector('summary');
    if (details === null || summary === null) throw new Error('Missing reasoning disclosure');
    expect(details.open).toBe(false);
    expect(details.getAttribute('data-appearance')).toBe('plain');
    act(() => summary.click());
    expect(details.open).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('[data-update]')?.click());
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('More readable reasoning');
    act(() => summary.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-complete]')?.click());
    expect(details.open).toBe(false);
    expect(
      container.querySelector('[data-slot="reasoning-block"]')?.getAttribute('data-state')
    ).toBe('completed');
  });

  it('allows explicitly expanded reasoning without creating a live-region announcement', () => {
    const markup = renderToStaticMarkup(
      <ReasoningBlock
        block={{ modelTurnIndex: 1, text: 'Readable reasoning' }}
        defaultOpen
        label="Thought process"
        stateLabel={null}
      />
    );
    expect(markup).toContain('open=""');
    expect(markup).not.toContain('ta-ui-reasoning-block__state');
    expect(markup).not.toContain('aria-live');
    expect(markup).not.toContain('style=');
  });

  it.each(['pending', 'success', 'error', 'interrupted'] as const)(
    'uses quiet tool feedback except for %s error/interruption semantics',
    (status) => {
      const container = renderInDocument(
        <ToolActivity
          activity={{
            callId: 'call-1',
            details: [{ label: 'Safe result', value: '2 records' }],
            modelTurnIndex: 1,
            status: status === 'interrupted' ? 'pending' : status,
            toolLabel: 'Lookup',
          }}
          detailsLabel={null}
          presentationStatus={status}
          statusLabels={{
            error: 'Failed',
            interrupted: 'Interrupted',
            pending: 'Running',
            success: 'Done',
          }}
        />
      );
      expect(container.querySelector('details')?.getAttribute('data-appearance')).toBe('plain');
      expect(container.querySelector('details')?.open).toBe(false);
      expect(
        container.querySelector('[data-slot="tool-activity"]')?.getAttribute('data-status')
      ).toBe(status);
      expect(container.querySelector('[data-slot="badge"]') !== null).toBe(
        status === 'error' || status === 'interrupted'
      );
    }
  );
});

function ReasoningUpdates() {
  const [text, setText] = useState('Initial readable reasoning');
  const [completed, setCompleted] = useState(false);
  return (
    <>
      <ReasoningBlock
        block={{ modelTurnIndex: 1, text }}
        label="Thought process"
        state={completed ? 'completed' : 'streaming'}
        stateLabel={null}
      />
      <button data-update onClick={() => setText('More readable reasoning')} type="button">
        Update
      </button>
      <button data-complete onClick={() => setCompleted(true)} type="button">
        Complete
      </button>
    </>
  );
}
