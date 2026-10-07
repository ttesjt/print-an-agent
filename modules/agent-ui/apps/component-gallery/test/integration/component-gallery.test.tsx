import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { App } from '../../src/app.js';

const mountedRoots = new Set<Root>();
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of mountedRoots) act(() => root.unmount());
  mountedRoots.clear();
  document.body.replaceChildren();
});

afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

describe('Agent UI Component Gallery', () => {
  it('exhibits every current Panel and layout variant through public components', () => {
    const container = renderStaticGallery();
    const panelVariants = valuesOf(
      container.querySelector('#panels'),
      '[data-slot="panel"]',
      'data-variant'
    );

    expect(panelVariants).toEqual(['default', 'muted', 'raised']);
    expect(container.querySelector('#panels [data-slot="panel-header"]')).not.toBeNull();
    expect(container.querySelector('#panels [data-slot="panel-body"]')).not.toBeNull();
    expect(container.querySelector('#panels [data-slot="panel-footer"]')).not.toBeNull();
    expect(container.querySelector('.ta-ui-gallery-consumer-panel')).not.toBeNull();

    const layouts = container.querySelector('#layouts');
    expect(valuesOf(layouts, '[data-slot="stack"]', 'data-space')).toEqual([
      'large',
      'medium',
      'none',
      'small',
    ]);
    expect(valuesOf(layouts, '[data-slot="stack"]', 'data-align')).toEqual([
      'center',
      'end',
      'start',
      'stretch',
    ]);
    expect(valuesOf(layouts, '[data-slot="cluster"]', 'data-align')).toEqual([
      'center',
      'end',
      'start',
      'stretch',
    ]);
    expect(valuesOf(layouts, '[data-slot="cluster"]', 'data-justify')).toEqual([
      'between',
      'center',
      'end',
      'start',
    ]);
    expect(valuesOf(layouts, '[data-slot="grid"]', 'data-columns')).toEqual([
      'auto',
      'one',
      'three',
      'two',
    ]);
    expect(
      container.querySelector('.ta-ui-gallery-narrow-frame [data-columns="three"]')
    ).not.toBeNull();
  });

  it('exhibits all four App Shell compositions without changing semantic reading order', () => {
    const container = renderStaticGallery();
    const expectations = Object.freeze({
      'main-only': ['app-shell-header', 'app-shell-main'],
      'sidebar-main': ['app-shell-header', 'app-shell-sidebar', 'app-shell-main'],
      'main-inspector': ['app-shell-header', 'app-shell-main', 'app-shell-inspector'],
      'sidebar-main-inspector': [
        'app-shell-header',
        'app-shell-sidebar',
        'app-shell-main',
        'app-shell-inspector',
      ],
    });

    for (const [composition, expectedSlots] of Object.entries(expectations)) {
      const shell = container.querySelector(`[data-composition="${composition}"]`);
      expect(shell, `${composition} preview must exist`).not.toBeNull();
      expect(
        [...(shell?.children ?? [])].map((element) => element.getAttribute('data-slot'))
      ).toEqual(expectedSlots);
    }
  });

  it('shows embedded light and dark theme boundaries', () => {
    const container = renderStaticGallery();
    const boundaries = [...container.querySelectorAll('.ta-ui-gallery-theme-boundary')];

    expect(boundaries.map((boundary) => boundary.getAttribute('data-ta-ui-theme'))).toEqual([
      'light',
      'dark',
    ]);
    expect(
      boundaries.every((boundary) => boundary.querySelector('[data-slot="panel"]') !== null)
    ).toBe(true);
  });

  it('exhibits the complete action, form, and feedback primitive surface', () => {
    const container = renderStaticGallery();
    const actions = container.querySelector('#actions');
    const forms = container.querySelector('#forms');
    const feedback = container.querySelector('#feedback');

    expect(valuesOf(actions, '[data-slot="button"]', 'data-appearance')).toEqual([
      'ghost',
      'outline',
      'solid',
      'text',
    ]);
    expect(valuesOf(actions, '[data-slot="button"]', 'data-tone')).toEqual([
      'accent',
      'critical',
      'neutral',
    ]);
    expect(valuesOf(actions, '[data-slot="icon-button"]', 'data-appearance')).toEqual([
      'ghost',
      'outline',
      'solid',
    ]);
    expect(actions?.querySelector('[data-slot="icon-button"][data-appearance="text"]')).toBeNull();
    expect(actions?.querySelector('[data-slot="text-link"]')).not.toBeNull();
    expect(actions?.querySelector('[data-pending="true"]')).not.toBeNull();
    expect(actions?.querySelector(':disabled')).not.toBeNull();

    for (const slot of [
      'form-field',
      'text-input',
      'textarea',
      'select',
      'checkbox',
      'switch',
      'fieldset',
      'fieldset-legend',
    ]) {
      expect(forms?.querySelector(`[data-slot="${slot}"]`), `${slot} preview`).not.toBeNull();
    }
    expect(forms?.querySelector('[aria-invalid="true"]')).not.toBeNull();
    expect(forms?.querySelector('[readonly]')).not.toBeNull();
    expect(
      forms?.querySelector('[data-gallery-direction="rtl"] [data-slot="switch"]')
    ).not.toBeNull();

    for (const slot of [
      'badge',
      'status',
      'alert',
      'inline-error',
      'empty-state',
      'spinner',
      'skeleton',
      'separator',
    ]) {
      expect(feedback?.querySelector(`[data-slot="${slot}"]`), `${slot} preview`).not.toBeNull();
    }
    expect(valuesOf(feedback, '[data-slot="badge"]', 'data-tone')).toEqual([
      'accent',
      'caution',
      'critical',
      'neutral',
      'positive',
    ]);
    expect(feedback?.querySelector('[data-announcement="polite"]')).not.toBeNull();
    expect(
      feedback?.querySelector('[data-slot="spinner"][data-announcement="none"]')
    ).not.toBeNull();
    expect(
      feedback?.querySelector('[data-slot="spinner"][data-announcement="polite"]')
    ).not.toBeNull();
  });

  it('exhibits overlay entry points and complete local-navigation semantics', () => {
    const container = renderStaticGallery();
    const overlays = container.querySelector('#overlays');
    const navigation = container.querySelector('#navigation');

    expect(overlays?.querySelector('[data-open-dialog]')).not.toBeNull();
    expect(overlays?.querySelector('[data-open-drawer="start"]')).not.toBeNull();
    expect(overlays?.querySelector('[data-open-drawer="end"]')).not.toBeNull();
    expect(overlays?.querySelector('[data-open-confirmation]')).not.toBeNull();
    expect(valuesOf(navigation, '[data-slot="tabs"]', 'data-activation')).toEqual([
      'automatic',
      'manual',
    ]);
    expect(valuesOf(navigation, '[data-slot="tabs"]', 'data-orientation')).toEqual([
      'horizontal',
      'vertical',
    ]);
    expect(navigation?.querySelector('[data-slot="disclosure"]')).not.toBeNull();
    expect(navigation?.querySelector('[data-slot="navigation-rail"]')).not.toBeNull();
  });

  it('exhibits Agent catalog, configuration, details, and lifecycle states', () => {
    const container = renderStaticGallery();
    const agents = container.querySelector('#agent-management');

    expect(agents?.querySelectorAll('[data-slot="agent-catalog"]')).toHaveLength(4);
    expect(agents?.querySelector('[data-slot="agent-list"]')).not.toBeNull();
    expect(agents?.querySelector('[data-selected="true"]')).not.toBeNull();
    expect(agents?.querySelector('[data-working="true"]')).not.toBeNull();
    expect(agents?.querySelector('[data-slot="agent-details"]')).not.toBeNull();
    expect(agents?.querySelectorAll('[data-slot="agent-config-form"]')).toHaveLength(2);
    expect(agents?.querySelector('[data-tone="caution"]')).not.toBeNull();
    expect(agents?.querySelectorAll('[data-slot="agent-lifecycle-actions"]')).toHaveLength(2);
  });

  it('exhibits Session catalog, details, branch navigation, and lifecycle capabilities', () => {
    const container = renderStaticGallery();
    const sessions = container.querySelector('#session-management');

    expect(sessions?.querySelectorAll('[data-slot="session-catalog"]')).toHaveLength(3);
    expect(sessions?.querySelector('[data-slot="session-list"]')).not.toBeNull();
    expect(sessions?.querySelector('[data-slot="session-details"]')).not.toBeNull();
    expect(sessions?.querySelectorAll('[data-slot="session-branch-item"]')).toHaveLength(2);
    expect(sessions?.querySelectorAll('[data-slot="session-lifecycle-actions"]')).toHaveLength(2);
  });

  it('exhibits completed, streaming, failed, reasoning, tool, and composer conversation states', () => {
    const conversation = renderStaticGallery().querySelector('#conversation');

    expect(conversation?.querySelectorAll('[data-slot="conversation-turn"]')).toHaveLength(3);
    expect(valuesOf(conversation, '[data-slot="conversation-turn"]', 'data-state')).toEqual([
      'completed',
      'failed',
      'streaming',
    ]);
    expect(conversation?.querySelectorAll('[data-slot="reasoning-block"]')).toHaveLength(4);
    expect(conversation?.querySelectorAll('[data-slot="tool-activity"]')).toHaveLength(3);
    expect(
      conversation?.querySelector('[data-slot="tool-activity"][data-status="interrupted"]')
        ?.textContent
    ).toContain('Interrupted');
    expect(conversation?.querySelectorAll('[data-slot="conversation-composer"]')).toHaveLength(2);
    expect(conversation?.textContent).toContain('Partial output is not a completed turn.');
  });

  it('opens nested modal Dialogs through the public Gallery surface', () => {
    const { container } = renderGallery();

    click(container, '[data-open-dialog]');
    const outer = container.querySelector<HTMLDialogElement>('[data-slot="dialog"][open]');
    expect(outer).not.toBeNull();
    expect(outer?.querySelector('form[method="dialog"]')).not.toBeNull();
    expect(outer?.textContent).toContain('Native form close');
    expect(document.documentElement.style.overflow).toBe('hidden');

    click(container, '[data-open-nested]');
    expect(
      container.querySelectorAll<HTMLDialogElement>('[data-slot="dialog"][open]')
    ).toHaveLength(2);
  });

  it('switches the application theme without installing a Theme Provider', () => {
    const { container } = renderGallery();
    const galleryRoot = container.querySelector('[data-gallery-root]');

    expect(galleryRoot?.getAttribute('data-ta-ui-theme')).toBe('system');
    click(container, '[data-theme-choice="dark"]');
    expect(galleryRoot?.getAttribute('data-ta-ui-theme')).toBe('dark');
    expect(
      container.querySelector('[data-theme-choice="dark"]')?.getAttribute('aria-pressed')
    ).toBe('true');
    click(container, '[data-theme-choice="light"]');
    expect(galleryRoot?.getAttribute('data-ta-ui-theme')).toBe('light');
  });

  it('bundles the public default stylesheet and isolated Gallery visual policy', () => {
    const publicRoot = join(import.meta.dirname, '../../dist/public');
    const assetsRoot = join(publicRoot, 'assets');
    const cssAssets = readdirSync(assetsRoot).filter((name) => name.endsWith('.css'));

    expect(cssAssets.length).toBeGreaterThan(0);
    const css = cssAssets.map((name) => readFileSync(join(assetsRoot, name), 'utf8')).join('\n');
    expect(css).toContain('--ta-ui-color-canvas');
    expect(css).toContain('.ta-ui-panel');
    expect(css).toContain('.ta-ui-app-shell');
    expect(css).toContain('.ta-ui-button');
    expect(css).toContain('.ta-ui-form-field');
    expect(css).toContain('.ta-ui-alert');
    expect(css).toContain('.ta-ui-modal-surface');
    expect(css).toContain('.ta-ui-navigation-rail');
    expect(css).toContain('.ta-ui-agent-catalog');
    expect(css).toContain('.ta-ui-conversation-turn');
    expect(css).toContain('.ta-ui-gallery-root');
    expect(css).toContain('[data-ta-ui-theme]');
    expect(css).toContain('color:var(--ta-ui-color-ink)');
    const consumer = readFileSync(join(publicRoot, 'consumer.html'), 'utf8');
    expect(consumer).not.toContain('rel="stylesheet"');
    expect(consumer).toContain('type="module"');
    expect(readFileSync(join(publicRoot, 'index.html'), 'utf8')).toContain(
      'Agent UI Component Gallery'
    );
  });
});

function renderStaticGallery(): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<App />);
  return container;
}

function renderGallery() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.add(root);
  act(() => root.render(<App />));
  return { container };
}

function click(container: ParentNode, selector: string): void {
  const target = container.querySelector<HTMLButtonElement>(selector);
  expect(target, `${selector} must resolve to a button`).not.toBeNull();
  act(() => target?.click());
}

function valuesOf(root: ParentNode | null, selector: string, attribute: string): readonly string[] {
  if (root === null) return [];
  return [
    ...new Set(
      [...root.querySelectorAll(selector)]
        .map((element) => element.getAttribute(attribute))
        .filter((value): value is string => value !== null)
    ),
  ].sort();
}
