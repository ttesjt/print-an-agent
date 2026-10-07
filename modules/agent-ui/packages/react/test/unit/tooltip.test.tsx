import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Button, Tooltip, type TooltipPlacement } from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(() => {
  cleanupReactRoots();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(disableReactActEnvironment);

function mount(options: Readonly<{ disabled?: boolean; placement?: TooltipPlacement }> = {}) {
  const container = renderInDocument(
    <Tooltip
      {...options}
      content="Auxiliary information"
      describedBy="existing-description"
      hoverDelayMilliseconds={50}
      closeDelayMilliseconds={30}
    >
      {(triggerProps) => <Button {...triggerProps}>Inspect</Button>}
    </Tooltip>
  );
  const trigger = container.querySelector('button');
  const tooltip = container.querySelector<HTMLDivElement>('[role="tooltip"]');
  const root = container.querySelector<HTMLDivElement>('[data-slot="tooltip"]');
  if (trigger === null || tooltip === null || root === null)
    throw new Error('Missing Tooltip fixture');
  return { container, root, tooltip, trigger };
}

function pointer(
  root: HTMLElement,
  type: 'pointerout' | 'pointerover',
  pointerType = 'mouse',
  relatedTarget: EventTarget | null = null
) {
  act(() => {
    root.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, relatedTarget }));
  });
}
function advance(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

describe('Tooltip interaction ownership', () => {
  it('establishes an accessible description without replacing the trigger or its native command', () => {
    const selected = vi.fn();
    const container = renderInDocument(
      <Tooltip content="Description">
        {(triggerProps) => (
          <Button {...triggerProps} onClick={selected}>
            Command
          </Button>
        )}
      </Tooltip>
    );
    const trigger = container.querySelector('button');
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(trigger?.getAttribute('aria-describedby')).toBe(tooltip?.id);
    expect(tooltip?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => trigger?.click());
    expect(selected).toHaveBeenCalledOnce();
  });

  it.each<TooltipPlacement>(['top', 'right', 'bottom', 'left'])(
    'exposes the %s placement as a style hook',
    (placement) => {
      const view = mount({ placement });
      expect(view.tooltip.getAttribute('data-placement')).toBe(placement);
      expect(view.trigger.getAttribute('aria-describedby')).toBe(
        `existing-description ${view.tooltip.id}`
      );
    }
  );

  it('opens on focus immediately, preserves focus, and closes on Escape without reopening in place', () => {
    vi.useFakeTimers();
    const view = mount();
    act(() => view.trigger.focus());
    expect(view.tooltip.hidden).toBe(false);
    expect(document.activeElement).toBe(view.trigger);
    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
    act(() => {
      view.trigger.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(view.tooltip.hidden).toBe(true);
    expect(document.activeElement).toBe(view.trigger);
    advance(100);
    expect(view.tooltip.hidden).toBe(true);
    act(() => view.trigger.blur());
    advance(30);
    act(() => view.trigger.focus());
    expect(view.tooltip.hidden).toBe(false);
  });

  it('delays hover, cancels abandoned opening, and permits crossing the gap into the tooltip', () => {
    vi.useFakeTimers();
    const view = mount();
    pointer(view.root, 'pointerover');
    advance(49);
    expect(view.tooltip.hidden).toBe(true);
    pointer(view.root, 'pointerout');
    advance(100);
    expect(view.tooltip.hidden).toBe(true);
    pointer(view.root, 'pointerover');
    advance(50);
    expect(view.tooltip.hidden).toBe(false);
    pointer(view.root, 'pointerout');
    advance(15);
    pointer(view.tooltip, 'pointerover');
    advance(40);
    expect(view.tooltip.hidden).toBe(false);
    pointer(view.tooltip, 'pointerout');
    advance(30);
    expect(view.tooltip.hidden).toBe(true);
  });

  it('does not let pointer leave close a focused tooltip or blur close a hovered tooltip', () => {
    vi.useFakeTimers();
    const view = mount();
    act(() => view.trigger.focus());
    pointer(view.root, 'pointerover');
    pointer(view.root, 'pointerout');
    advance(100);
    expect(view.tooltip.hidden).toBe(false);
    pointer(view.root, 'pointerover');
    act(() => view.trigger.blur());
    advance(100);
    expect(view.tooltip.hidden).toBe(false);
    pointer(view.root, 'pointerout');
    advance(30);
    expect(view.tooltip.hidden).toBe(true);
  });

  it('dismisses hover-only content from a document Escape and removes its listener after closing', () => {
    vi.useFakeTimers();
    const view = mount();
    pointer(view.root, 'pointerover');
    advance(50);
    const escape = () =>
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
    const first = escape();
    act(() => {
      document.dispatchEvent(first);
    });
    expect(first.defaultPrevented).toBe(true);
    expect(view.tooltip.hidden).toBe(true);
    const afterClose = escape();
    act(() => {
      document.dispatchEvent(afterClose);
    });
    expect(afterClose.defaultPrevented).toBe(false);
    advance(100);
    expect(view.tooltip.hidden).toBe(true);
  });

  it('does not synthesize mouse hover for touch, while a focusable trigger remains usable', () => {
    vi.useFakeTimers();
    const view = mount();
    pointer(view.root, 'pointerover', 'touch');
    advance(100);
    expect(view.tooltip.hidden).toBe(true);
    act(() => view.trigger.focus());
    expect(view.tooltip.hidden).toBe(false);
    act(() => view.trigger.blur());
    advance(30);
    expect(view.tooltip.hidden).toBe(true);
  });

  it('keeps disabled content closed and preserves only the consumer description', () => {
    vi.useFakeTimers();
    const view = mount({ disabled: true });
    act(() => view.trigger.focus());
    pointer(view.root, 'pointerover');
    advance(100);
    expect(view.tooltip.hidden).toBe(true);
    expect(view.trigger.getAttribute('aria-describedby')).toBe('existing-description');
  });

  it('cleans pending timers and document listeners on unmount', () => {
    vi.useFakeTimers();
    const view = mount();
    pointer(view.root, 'pointerover');
    expect(vi.getTimerCount()).toBe(1);
    act(cleanupReactRoots);
    expect(vi.getTimerCount()).toBe(0);
    const focused = mount();
    act(() => focused.trigger.focus());
    act(cleanupReactRoots);
    const escape = new KeyboardEvent('keydown', { cancelable: true, key: 'Escape' });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('opens and releases the native top-layer surface when anchored popovers are supported', () => {
    const show = vi.fn();
    const hide = vi.fn();
    const showDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
    const hideDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover');
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      configurable: true,
      value: show,
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
      configurable: true,
      value: hide,
    });
    vi.spyOn(CSS, 'supports').mockReturnValue(true);
    try {
      const view = mount();
      expect(view.tooltip.getAttribute('data-positioning')).toBe('native');
      expect(view.tooltip.getAttribute('popover')).toBe('manual');
      expect(show).not.toHaveBeenCalled();
      act(() => view.trigger.focus());
      expect(show).toHaveBeenCalledOnce();
      act(() => {
        view.trigger.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Escape',
          })
        );
      });
      expect(hide).toHaveBeenCalledOnce();
      act(() => {
        view.trigger.blur();
        view.trigger.focus();
      });
      expect(show).toHaveBeenCalledTimes(2);
      act(cleanupReactRoots);
      // Removing the element releases the browser's top layer; do not invoke native APIs on a
      // detached surface during passive cleanup.
      expect(view.tooltip.isConnected).toBe(false);
      expect(hide).toHaveBeenCalledOnce();
    } finally {
      act(cleanupReactRoots);
      if (showDescriptor === undefined)
        Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
      else Object.defineProperty(HTMLElement.prototype, 'showPopover', showDescriptor);
      if (hideDescriptor === undefined)
        Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
      else Object.defineProperty(HTMLElement.prototype, 'hidePopover', hideDescriptor);
    }
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid delay %s instead of overflowing browser timers',
    (delay) => {
      expect(() =>
        renderInDocument(
          <Tooltip content="Info" hoverDelayMilliseconds={delay}>
            {(props) => <Button {...props}>Trigger</Button>}
          </Tooltip>
        )
      ).toThrow(RangeError);
    }
  );
});
