import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('default Agent UI styles', () => {
  it('assembles ordered, independently importable visual layers', () => {
    const source = readStyle('default.css');
    const manifest = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');

    expect(source).toContain('@layer ta-ui-tokens, ta-ui-base, ta-ui-layout, ta-ui-components;');
    expect(source).toContain("@import './tokens.css' layer(ta-ui-tokens);");
    expect(source).toContain("@import './base.css' layer(ta-ui-base);");
    expect(source).toContain("@import './layout.css' layer(ta-ui-layout);");
    expect(source).toContain("@import './components.css' layer(ta-ui-components);");
    expect(source).toContain("@import './actions.css' layer(ta-ui-components);");
    expect(source).toContain("@import './forms.css' layer(ta-ui-components);");
    expect(source).toContain("@import './feedback.css' layer(ta-ui-components);");
    expect(source).toContain("@import './overlays.css' layer(ta-ui-components);");
    expect(source).toContain("@import './navigation.css' layer(ta-ui-components);");
    expect(manifest).toContain('"./layout.css"');
    expect(manifest).toContain('"./actions.css"');
    expect(manifest).toContain('"./forms.css"');
    expect(manifest).toContain('"./feedback.css"');
    expect(manifest).toContain('"./overlays.css"');
    expect(manifest).toContain('"./navigation.css"');
  });

  it('defines semantic visual scales and explicit theme modes', () => {
    const tokens = readStyle('tokens.css');

    for (const token of [
      '--ta-ui-color-canvas:',
      '--ta-ui-color-critical:',
      '--ta-ui-color-critical-soft:',
      '--ta-ui-font-size-body:',
      '--ta-ui-space-8:',
      '--ta-ui-size-sidebar:',
      '--ta-ui-size-control-small:',
      '--ta-ui-radius-large:',
      '--ta-ui-shadow-raised:',
      '--ta-ui-layer-overlay:',
      '--ta-ui-motion-medium:',
      '--ta-ui-focus-width:',
    ]) {
      expect(tokens).toContain(token);
    }

    expect(tokens).toContain("[data-ta-ui-theme='light']");
    expect(tokens).toContain("[data-ta-ui-theme='dark']");
    expect(tokens).toContain("[data-ta-ui-theme='system']");
    expect(tokens).toContain('@media (prefers-color-scheme: dark)');
    const systemDarkTheme = tokens.match(
      /@media \(prefers-color-scheme: dark\) \{\s*:where\(\[data-ta-ui-theme='system'\]\) \{([\s\S]*?)\n {2}\}\n\}/u
    )?.[1];
    expect(systemDarkTheme).toContain('--ta-ui-color-positive-soft: #263d30;');
    expect(systemDarkTheme).toContain('--ta-ui-color-critical-soft: #4a2b2b;');
  });

  it('styles actions, forms, and feedback exclusively through semantic hooks', () => {
    const actions = readStyle('actions.css');
    const forms = readStyle('forms.css');
    const feedback = readStyle('feedback.css');

    for (const hook of ['.ta-ui-button', '.ta-ui-icon-button', '.ta-ui-text-link']) {
      expect(actions).toContain(hook);
    }
    for (const hook of [
      '.ta-ui-form-field',
      '.ta-ui-text-input',
      '.ta-ui-textarea',
      '.ta-ui-select',
      '.ta-ui-checkbox',
      '.ta-ui-switch',
      '.ta-ui-fieldset',
    ]) {
      expect(forms).toContain(hook);
    }
    for (const hook of [
      '.ta-ui-badge',
      '.ta-ui-status',
      '.ta-ui-alert',
      '.ta-ui-inline-error',
      '.ta-ui-empty-state',
      '.ta-ui-spinner',
      '.ta-ui-skeleton',
      '.ta-ui-separator',
    ]) {
      expect(feedback).toContain(hook);
    }

    expect(actions).toContain("[data-pending='true']");
    expect(actions).not.toMatch(/\.ta-ui-icon-button[^,{]*\[data-appearance='text'\]/u);
    expect(forms).toContain("[aria-invalid='true']");
    expect(forms).toContain(':where(.ta-ui-switch:dir(rtl))');
    expect(forms).toContain('--ta-ui-switch-thumb-translation: -1.05rem;');
    expect(feedback).toContain("[data-tone='critical']");
    expect(forms).toContain('@media (forced-colors: active)');
    expect(feedback).toContain('@media (forced-colors: active)');
  });

  it('styles modal overlays and local navigation through stable semantic hooks', () => {
    const overlays = readStyle('overlays.css');
    const navigation = readStyle('navigation.css');

    for (const hook of [
      '.ta-ui-modal-surface',
      '.ta-ui-dialog__header',
      '.ta-ui-drawer',
      '.ta-ui-confirmation-dialog__error',
    ]) {
      expect(overlays).toContain(hook);
    }
    expect(overlays).toContain("[data-placement='start']");
    expect(overlays).toContain("[data-placement='end']");
    expect(overlays).toContain('::backdrop');

    for (const hook of [
      '.ta-ui-tabs',
      '.ta-ui-tab-list',
      '.ta-ui-tab',
      '.ta-ui-tab-panel',
      '.ta-ui-disclosure',
      '.ta-ui-navigation-rail',
    ]) {
      expect(navigation).toContain(hook);
    }
    expect(navigation).toContain("[data-orientation='vertical']");
    expect(navigation).toContain("[data-selected='true']");
  });

  it('provides focus, reduced-motion, and forced-colors behavior', () => {
    const tokens = readStyle('tokens.css');
    const base = readStyle('base.css');
    const components = readStyle('components.css');

    expect(base).toContain(':focus-visible');
    expect(base).toContain('@media (prefers-reduced-motion: reduce)');
    expect(tokens).toContain('@media (forced-colors: active)');
    expect(base).toContain('@media (forced-colors: active)');
    expect(components).toContain('@media (forced-colors: active)');
  });

  it('treats body-ported modal surfaces as complete base-style roots', () => {
    const base = readStyle('base.css');

    expect(base).toContain(':where(.ta-ui-root, .ta-ui-modal-surface)');
    expect(base).toContain(':where(.ta-ui-root *, .ta-ui-modal-surface *)');
    expect(base).toContain('.ta-ui-modal-surface button');
    expect(base).toContain('.ta-ui-modal-surface input');
    expect(base).toContain('.ta-ui-modal-surface h2');
    expect(base).toContain('.ta-ui-modal-surface p');
    expect(base).toContain('.ta-ui-modal-surface :focus-visible');
  });

  it('rebinds inherited foreground color at embedded theme boundaries', () => {
    const base = readStyle('base.css');

    expect(base).toMatch(
      /:where\(\[data-ta-ui-theme\]\)\s*\{\s*color:\s*var\(--ta-ui-color-ink\);\s*\}/u
    );
  });

  it('uses stable low-specificity hooks for layout and components', () => {
    const layout = readStyle('layout.css');
    const components = readStyle('components.css');

    expect(layout).toContain(':where(.ta-ui-stack)');
    expect(layout).toContain(':where(.ta-ui-cluster)');
    expect(layout).toContain(':where(.ta-ui-grid)');
    expect(layout).toContain(':where(.ta-ui-app-shell)');
    expect(layout).toContain(".ta-ui-grid[data-columns='auto']");
    expect(components).toContain(':where(.ta-ui-panel)');
    expect(components).toContain('.ta-ui-panel__header');
    expect(components).toContain(".ta-ui-panel[data-variant='muted']");
  });

  it('reflows responsive regions without hiding or reordering semantic content', () => {
    const layout = readStyle('layout.css');

    expect(layout).toContain('@media (max-width: 68rem)');
    expect(layout).toMatch(/'header header header'\s*'sidebar main inspector'/u);
    expect(layout).toMatch(/'header'\s*'sidebar'\s*'main'\s*'inspector'/u);
    expect(layout).not.toMatch(/\bdisplay\s*:\s*none\b/u);
    expect(layout).not.toMatch(/\border\s*:/u);
  });

  it('derives desktop App Shell columns from the regions that are actually present', () => {
    const layout = readStyle('layout.css');

    expect(layout).toMatch(/'header'\s*'main'/u);
    expect(layout).toContain(':where(.ta-ui-app-shell:has(> .ta-ui-app-shell__sidebar))');
    expect(layout).toMatch(/'header header'\s*'sidebar main'/u);
    expect(layout).toContain(':where(.ta-ui-app-shell:has(> .ta-ui-app-shell__inspector))');
    expect(layout).toMatch(/'header header'\s*'main inspector'/u);
    expect(layout).toContain(
      '.ta-ui-app-shell:has(> .ta-ui-app-shell__sidebar):has(> .ta-ui-app-shell__inspector)'
    );
    expect(layout).toMatch(/'header header header'\s*'sidebar main inspector'/u);
  });

  it('keeps the reusable root and Panel free from demo-only centering and max widths', () => {
    const base = readStyle('base.css');
    const components = readStyle('components.css');

    expect(base).not.toContain('place-items: center');
    expect(components).not.toContain('44rem');
    expect(components).not.toContain('max-inline-size');
  });
});

function readStyle(name: string): string {
  return readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8');
}
