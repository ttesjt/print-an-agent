import { act, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Button, IconButton, TextLink } from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

describe('action controls', () => {
  it('keeps commands and navigation on their native elements', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Button className="consumer-action">Save</Button>
        <IconButton aria-label="Refresh catalog">↻</IconButton>
        <TextLink href="/agents">View agents</TextLink>
      </div>
    );

    expect(markup).toContain(
      '<button class="ta-ui-button consumer-action" data-appearance="solid"'
    );
    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('<button aria-label="Refresh catalog"');
    expect(markup).toContain('class="ta-ui-icon-button"');
    expect(markup).toContain('<a href="/agents" class="ta-ui-text-link"');
    expect(markup).not.toContain('style=');
  });

  it('publishes orthogonal appearance, tone, and size hooks', () => {
    const markup = renderToStaticMarkup(
      <Button appearance="text" size="small" tone="critical">
        Remove
      </Button>
    );

    expect(markup).toContain('data-appearance="text"');
    expect(markup).toContain('data-size="small"');
    expect(markup).toContain('data-tone="critical"');
  });

  it('makes pending actions busy and prevents duplicate activation', () => {
    const onClick = vi.fn();
    const buttonRef = createRef<HTMLButtonElement>();
    const container = renderInDocument(
      <Button onClick={onClick} pending ref={buttonRef}>
        Saving
      </Button>
    );
    const button = container.querySelector<HTMLButtonElement>('button');

    expect(button?.disabled).toBe(true);
    expect(buttonRef.current).toBe(button);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('data-pending')).toBe('true');
    act(() => button?.click());
    expect(onClick).not.toHaveBeenCalled();
  });
});
