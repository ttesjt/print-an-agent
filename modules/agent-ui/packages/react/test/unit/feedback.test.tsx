import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  InlineError,
  Separator,
  Skeleton,
  Spinner,
  Status,
} from '../../src/index.js';

describe('feedback primitives', () => {
  it('separates visual tone from live-region behavior', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Alert tone="critical">Existing failure</Alert>
        <Alert announcement="assertive" tone="critical">
          New failure
        </Alert>
        <Status announcement="polite" tone="positive">
          Saved
        </Status>
        <InlineError id="name-error">Name is required</InlineError>
      </div>
    );

    expect(markup).toContain(
      '<div class="ta-ui-alert" data-announcement="none" data-slot="alert" data-tone="critical"'
    );
    expect(markup).toContain('aria-live="assertive" role="alert"');
    expect(markup).toContain('aria-live="polite" role="status"');
    expect(markup).toContain('<p id="name-error" class="ta-ui-inline-error"');
  });

  it('makes spinner accessibility intentional and skeletons presentation-only', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Spinner data-spinner="silent" label="Loading sessions" />
        <Spinner announcement="polite" data-spinner="polite" label="Loading messages" />
        <Spinner data-spinner="decorative" decorative />
        <Skeleton shape="block" />
      </div>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const silent = container.querySelector('[data-spinner="silent"]');
    const polite = container.querySelector('[data-spinner="polite"]');
    const decorative = container.querySelector('[data-spinner="decorative"]');

    expect(silent?.getAttribute('aria-label')).toBe('Loading sessions');
    expect(silent?.getAttribute('role')).toBe('progressbar');
    expect(silent?.getAttribute('data-announcement')).toBe('none');
    expect(silent?.hasAttribute('aria-live')).toBe(false);
    expect(polite?.getAttribute('role')).toBe('progressbar');
    expect(polite?.getAttribute('aria-live')).toBe('polite');
    expect(polite?.getAttribute('aria-atomic')).toBe('true');
    expect(decorative?.getAttribute('aria-hidden')).toBe('true');
    expect(decorative?.hasAttribute('aria-label')).toBe(false);
    expect(decorative?.hasAttribute('role')).toBe(false);
    expect(markup).toContain('data-shape="block"');
  });

  it('provides composable empty, badge, and separator structures', () => {
    const markup = renderToStaticMarkup(
      <EmptyState
        actions={<Button>Create Agent</Button>}
        description="Create one to begin."
        title="No Agents"
      >
        <Badge tone="accent">Catalog</Badge>
        <Separator />
      </EmptyState>
    );

    expect(markup).toContain('data-slot="empty-state-title"');
    expect(markup).toContain('data-slot="empty-state-description"');
    expect(markup).toContain('data-slot="empty-state-actions"');
    expect(markup).toContain('class="ta-ui-badge"');
    expect(markup).toContain('role="separator"');
    expect(markup).not.toContain('style=');
  });
});
