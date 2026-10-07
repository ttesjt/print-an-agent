import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ActionBar, Button, ConversationTurnActions, TextLink } from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

const DETAILS = {
  'aria-label': 'Turn actions',
  answeredAt: '2026-02-01T12:01:00.000Z',
  answeredLabel: 'Answered',
  forkLabel: 'Fork',
  formatTimestamp: (value: string) => `Formatted ${value}`,
  rewindLabel: 'Rewind',
  sentAt: '2026-02-01T12:00:00.000Z',
  sentLabel: 'Sent',
  timestampsLabel: 'Timestamps',
};

describe('Action bar composition', () => {
  it('groups native actions and information without inventing menu or toolbar keyboard behavior', () => {
    const container = renderInDocument(
      <ActionBar aria-label="Actions" className="consumer-extension">
        <Button>Command</Button>
        <TextLink href="#target">Navigation</TextLink>
        <span>Information</span>
      </ActionBar>
    );
    expect(container.querySelector('[data-slot="action-bar"]')?.getAttribute('role')).toBe('group');
    expect(container.querySelector('.consumer-extension')).not.toBeNull();
    expect(container.querySelector('button')?.getAttribute('tabindex')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#target');
    expect(container.querySelector('[role="menu"], [role="toolbar"]')).toBeNull();
  });

  it('keeps commands visible and metadata secondary, formatting timestamps through the consumer', () => {
    const fork = vi.fn();
    const rewind = vi.fn();
    const container = renderInDocument(
      <ConversationTurnActions
        {...DETAILS}
        onFork={fork}
        onRewind={rewind}
        tooltipPlacement="left"
      />
    );
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Fork', 'Rewind', '']);
    expect(container.querySelector('details')).toBeNull();
    const tooltip = container.querySelector<HTMLDivElement>('[role="tooltip"]');
    expect(tooltip?.hidden).toBe(true);
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    expect(fork).toHaveBeenCalledOnce();
    expect(rewind).toHaveBeenCalledOnce();
    act(() => buttons[2]?.focus());
    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.getAttribute('data-placement')).toBe('left');
    expect(
      [...container.querySelectorAll('time')].map((time) => [time.dateTime, time.textContent])
    ).toEqual([
      [DETAILS.sentAt, `Formatted ${DETAILS.sentAt}`],
      [DETAILS.answeredAt, `Formatted ${DETAILS.answeredAt}`],
    ]);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(buttons[2]?.getAttribute('aria-label')).toBe('Timestamps');
  });

  it('installs commands only when their callbacks exist, while keeping read-only timestamps available', () => {
    const container = renderInDocument(<ConversationTurnActions {...DETAILS} />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Timestamps');
  });

  it('disables conflicting mutations during pending work without hiding metadata', () => {
    const fork = vi.fn();
    const rewind = vi.fn();
    const container = renderInDocument(
      <ConversationTurnActions {...DETAILS} forkPending onFork={fork} onRewind={rewind} />
    );
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((button) => button.disabled)).toEqual([true, true, false]);
    expect(buttons[0]?.getAttribute('aria-busy')).toBe('true');
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    expect(fork).not.toHaveBeenCalled();
    expect(rewind).not.toHaveBeenCalled();
  });
});
