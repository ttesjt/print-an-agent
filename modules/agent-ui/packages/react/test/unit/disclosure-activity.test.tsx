import { act, StrictMode, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  Disclosure,
  DisclosurePanel,
  DisclosureSummary,
  ReasoningBlock,
  type DisclosureContentMaxHeight,
} from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

describe('Disclosure activity ownership', () => {
  it.each([
    { autoCollapse: false, autoExpand: false, opened: false, ended: false },
    { autoCollapse: true, autoExpand: false, opened: false, ended: false },
    { autoCollapse: false, autoExpand: true, opened: true, ended: true },
    { autoCollapse: true, autoExpand: true, opened: true, ended: false },
  ])('keeps optional expansion and collapse independent: %j', (mode) => {
    const container = renderInDocument(<ActivityHarness {...mode} />);
    const details = disclosure(container);
    expect(details.open).toBe(false);
    click(container, '[data-start]');
    expect(details.open).toBe(mode.opened);
    click(container, '[data-update]');
    expect(details.open).toBe(mode.opened);
    click(container, '[data-finish]');
    expect(details.open).toBe(mode.ended);
  });

  it('does not close default-expanded content or start automation for completed history', () => {
    const container = renderInDocument(<ActivityHarness autoExpand autoCollapse defaultOpen />);
    const details = disclosure(container);
    expect(details.open).toBe(true);
    click(container, '[data-finish]');
    expect(details.open).toBe(true);
    click(container, '[data-start]');
    click(container, '[data-finish]');
    expect(details.open).toBe(true);
  });

  it.each([false, true])('preserves manual takeover, reopened=%s', (reopen) => {
    const container = renderInDocument(<ActivityHarness autoExpand autoCollapse />);
    const details = disclosure(container);
    click(container, '[data-start]');
    click(details, 'summary');
    expect(details.open).toBe(false);
    click(container, '[data-update]');
    expect(details.open).toBe(false);
    if (reopen) click(details, 'summary');
    click(container, '[data-finish]');
    expect(details.open).toBe(reopen);
  });

  it('starts a fresh activity cycle without inheriting the preceding manual takeover', () => {
    const container = renderInDocument(<ActivityHarness autoExpand autoCollapse />);
    const details = disclosure(container);
    click(container, '[data-start]');
    click(details, 'summary');
    click(container, '[data-finish]');
    click(container, '[data-start]');
    expect(details.open).toBe(true);
    click(container, '[data-finish]');
    expect(details.open).toBe(false);
  });

  it('does not treat automatically generated native toggle as a manual takeover', () => {
    const changed = vi.fn();
    const container = renderInDocument(
      <StrictMode>
        <ActivityHarness autoExpand autoCollapse onOpenChange={changed} />
      </StrictMode>
    );
    const details = disclosure(container);
    click(container, '[data-start]');
    act(() => {
      details.dispatchEvent(new Event('toggle'));
    });
    click(container, '[data-finish]');
    act(() => {
      details.dispatchEvent(new Event('toggle'));
    });
    expect(details.open).toBe(false);
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });

  it('does not let cancelled summary activation or clicking a summary link take control', () => {
    const container = renderInDocument(
      <ActivityHarness autoExpand autoCollapse preventSummaryActivation />
    );
    const details = disclosure(container);
    click(container, '[data-start]');
    click(details, 'summary');
    expect(details.open).toBe(true);
    click(container, '[data-finish]');
    expect(details.open).toBe(false);

    const linked = renderInDocument(<ActivityHarness autoExpand autoCollapse summaryLink />);
    click(linked, '[data-start]');
    click(linked, 'a');
    click(linked, '[data-finish]');
    expect(disclosure(linked).open).toBe(false);
  });

  it('delays automatic collapse until keyboard focus leaves the content, without transferring focus', () => {
    const container = renderInDocument(<ActivityHarness autoExpand autoCollapse />);
    const details = disclosure(container);
    click(container, '[data-start]');
    const input = container.querySelector('input');
    const next = container.querySelector<HTMLButtonElement>('[data-after]');
    if (input === null || next === null) throw new Error('Missing focus fixture');
    act(() => input.focus());
    click(container, '[data-finish]');
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(input);
    act(() => next.focus());
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it('cancels a pending collapse when the reader manually changes expansion', () => {
    const container = renderInDocument(<ActivityHarness autoExpand autoCollapse />);
    const details = disclosure(container);
    click(container, '[data-start]');
    act(() => container.querySelector('input')?.focus());
    click(container, '[data-finish]');
    click(details, 'summary');
    click(details, 'summary');
    act(() => container.querySelector<HTMLButtonElement>('[data-after]')?.focus());
    expect(details.open).toBe(true);
  });

  it('retains controlled owner authority for user and imperative native changes', () => {
    const changed = vi.fn();
    const container = renderInDocument(
      <Disclosure open={false} onOpenChange={changed}>
        <DisclosureSummary>Controlled</DisclosureSummary>
        <DisclosurePanel>Content</DisclosurePanel>
      </Disclosure>
    );
    const details = disclosure(container);
    click(details, 'summary');
    expect(changed).toHaveBeenCalledWith(true);
    expect(details.open).toBe(false);
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    expect(details.open).toBe(false);
  });

  it('does not let nested Disclosure activation take over its parent activity', () => {
    const container = renderInDocument(<ActivityHarness autoExpand autoCollapse nested />);
    const outer = disclosure(container);
    click(container, '[data-start]');
    click(container, '[data-nested] summary');
    expect(container.querySelector<HTMLDetailsElement>('[data-nested]')?.open).toBe(true);
    expect(outer.open).toBe(true);
    click(container, '[data-finish]');
    expect(outer.open).toBe(false);
  });

  it('requires explicit activity input instead of inferring an end from reasoning state', () => {
    const container = renderInDocument(<ReasoningHarness />);
    const details = disclosure(container);
    expect(details.open).toBe(true);
    click(container, '[data-completed-presentation]');
    expect(details.open).toBe(true);
    click(container, '[data-end-activity]');
    expect(details.open).toBe(false);
  });
});

describe('Disclosure content height contract', () => {
  it.each<DisclosureContentMaxHeight>(['small', 'medium', 'large'])(
    'makes a %s bounded panel named and keyboard reachable without inline styles',
    (height) => {
      const container = renderInDocument(
        <ReasoningBlock
          block={{ modelTurnIndex: 1, text: 'Readable content' }}
          contentMaxHeight={height}
          defaultOpen
          label="Thought process"
          stateLabel={null}
        />
      );
      const panel = container.querySelector<HTMLElement>('[data-slot="disclosure-panel"]');
      expect(panel?.getAttribute('data-content-max-height')).toBe(height);
      expect(panel?.tabIndex).toBe(0);
      expect(panel?.getAttribute('role')).toBe('region');
      expect(panel?.getAttribute('aria-labelledby')).toBe(container.querySelector('summary')?.id);
      expect(container.querySelector('[style]')).toBeNull();
    }
  );

  it('does not introduce a scroll region when no content height limit is requested', () => {
    const markup = renderToStaticMarkup(
      <Disclosure defaultOpen>
        <DisclosureSummary>Natural height</DisclosureSummary>
        <DisclosurePanel>Content</DisclosurePanel>
      </Disclosure>
    );
    expect(markup).not.toContain('data-content-max-height');
    expect(markup).not.toContain('tabindex');
    expect(markup).not.toContain('role="region"');
  });
});

function ActivityHarness({
  autoCollapse,
  autoExpand,
  defaultOpen = false,
  nested = false,
  onOpenChange,
  preventSummaryActivation = false,
  summaryLink = false,
}: Readonly<{
  autoCollapse: boolean;
  autoExpand: boolean;
  defaultOpen?: boolean;
  nested?: boolean;
  onOpenChange?: (open: boolean) => void;
  preventSummaryActivation?: boolean;
  summaryLink?: boolean;
}>) {
  const [active, setActive] = useState(false);
  const [text, setText] = useState('Initial content');
  return (
    <>
      <Disclosure
        activity={{ active, autoCollapse, autoExpand }}
        defaultOpen={defaultOpen}
        {...(onOpenChange === undefined ? {} : { onOpenChange })}
      >
        <DisclosureSummary
          onClickCapture={(event) => {
            if (preventSummaryActivation) event.preventDefault();
          }}
        >
          Details
          {summaryLink ? <a href="#fixture">Open fixture</a> : null}
        </DisclosureSummary>
        <DisclosurePanel>
          <p>{text}</p>
          <input aria-label="Focus inside content" />
          {nested ? (
            <Disclosure data-nested>
              <DisclosureSummary>Nested</DisclosureSummary>
              <DisclosurePanel>Nested content</DisclosurePanel>
            </Disclosure>
          ) : null}
        </DisclosurePanel>
      </Disclosure>
      <button data-start onClick={() => setActive(true)} type="button">
        Start
      </button>
      <button data-update onClick={() => setText('Updated content')} type="button">
        Update
      </button>
      <button data-finish onClick={() => setActive(false)} type="button">
        Finish
      </button>
      <button data-after type="button">
        After
      </button>
    </>
  );
}

function ReasoningHarness() {
  const [active, setActive] = useState(true);
  const [completed, setCompleted] = useState(false);
  return (
    <>
      <ReasoningBlock
        activity={{ active, autoCollapse: true, autoExpand: true }}
        block={{ modelTurnIndex: 1, text: 'Content' }}
        label="Thought process"
        state={completed ? 'completed' : 'streaming'}
        stateLabel={null}
      />
      <button data-completed-presentation onClick={() => setCompleted(true)} type="button">
        Mark completed
      </button>
      <button data-end-activity onClick={() => setActive(false)} type="button">
        End activity
      </button>
    </>
  );
}

function disclosure(container: ParentNode): HTMLDetailsElement {
  const details = container.querySelector('details');
  if (details === null) throw new Error('Missing Disclosure');
  return details;
}

function click(container: ParentNode, selector: string): void {
  const target = container.querySelector<HTMLElement>(selector);
  if (target === null) throw new Error(`Missing ${selector}`);
  act(() => target.click());
}
