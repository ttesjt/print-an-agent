import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentCatalogPort, AgentSummary } from '@ta-agent/ui-contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDeterministicAgentCatalog } from '../../src/adapters/deterministic-agent-catalog.js';
import { App } from '../../src/app.js';

const AGENTS: readonly AgentSummary[] = Object.freeze([
  Object.freeze({
    agentId: 'research-assistant',
    displayName: 'Research Assistant',
    status: 'active',
  }),
  Object.freeze({
    agentId: 'review-assistant',
    displayName: 'Review Assistant',
    status: 'disabled',
  }),
]);

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

describe('Agent Web walking skeleton', () => {
  it('renders an unstyled application structure before client effects run', () => {
    const markup = renderToStaticMarkup(<App agentCatalog={createDeterministicAgentCatalog()} />);

    expect(markup).toContain('class="ta-ui-app-shell ta-ui-root"');
    expect(markup).toContain('class="ta-ui-app-shell__header"');
    expect(markup).toContain('class="ta-ui-app-shell__sidebar"');
    expect(markup).toContain('class="ta-ui-app-shell__main"');
    expect(markup).toContain('class="ta-ui-app-shell__inspector"');
    expect(markup).toContain('class="ta-ui-panel"');
    expect(markup).toContain('Loading Agents…');
    expect(markup).not.toContain('style=');
  });

  it('keeps responsive regions in a stable semantic DOM order', () => {
    const pending = createDeferred<readonly AgentSummary[]>();
    const view = renderApp({ listAgents: () => pending.promise });
    const shell = view.container.querySelector('[data-slot="app-shell"]');
    const slots = [...(shell?.children ?? [])].map((element) => element.getAttribute('data-slot'));

    expect(slots).toEqual([
      'app-shell-header',
      'app-shell-sidebar',
      'app-shell-main',
      'app-shell-inspector',
    ]);
    expect(shell?.querySelector('header')).not.toBeNull();
    expect(shell?.querySelector('main')).not.toBeNull();
    expect(shell?.querySelectorAll('aside')).toHaveLength(2);
  });

  it('loads the Agent catalog on mount and renders the ready state', async () => {
    const pending = createDeferred<readonly AgentSummary[]>();
    const listAgents = vi.fn<AgentCatalogPort['listAgents']>(() => pending.promise);
    const view = renderApp({ listAgents });

    expect(view.container.textContent).toContain('Loading Agents…');
    expect(listAgents).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve(AGENTS);
      await pending.promise;
    });

    expect(view.container.querySelector('[role="status"]')).toBeNull();
    expect(view.container.querySelector('[aria-label="Agents"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Research Assistant');
    expect(view.container.textContent).toContain('Review Assistant');
  });

  it('renders a failed state when the Agent catalog rejects', async () => {
    const pending = createDeferred<readonly AgentSummary[]>();
    const listAgents = vi.fn<AgentCatalogPort['listAgents']>(() => pending.promise);
    const view = renderApp({ listAgents });

    await act(async () => {
      pending.reject(new Error('catalog unavailable'));
      await pending.promise.catch(() => undefined);
    });

    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Agents could not be loaded.'
    );
  });

  it('cancels the catalog request and ignores a late result after unmount', async () => {
    const pending = createDeferred<readonly AgentSummary[]>();
    let receivedSignal: AbortSignal | undefined;
    const listAgents = vi.fn<AgentCatalogPort['listAgents']>((options = {}) => {
      receivedSignal = options.signal;
      return pending.promise;
    });
    const view = renderApp({ listAgents });

    expect(receivedSignal?.aborted).toBe(false);
    view.unmount();
    expect(receivedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(AGENTS);
      await pending.promise;
    });

    expect(view.container.childElementCount).toBe(0);
  });

  it('propagates caller cancellation through the deterministic adapter', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by test'));

    await expect(
      createDeterministicAgentCatalog().listAgents({ signal: controller.signal })
    ).rejects.toThrow('cancelled by test');
  });

  it('bundles the optional default stylesheet through its public package export', () => {
    const publicRoot = join(import.meta.dirname, '../../dist/public');
    const assetsRoot = join(publicRoot, 'assets');
    const cssAsset = readdirSync(assetsRoot).find((name) => name.endsWith('.css'));

    expect(cssAsset).toBeDefined();
    const css = readFileSync(join(assetsRoot, cssAsset ?? ''), 'utf8');
    expect(css).toContain('--ta-ui-color-canvas');
    expect(css).toContain('.ta-ui-app-shell');
    expect(css).toContain('.ta-ui-panel');
    expect(readFileSync(join(publicRoot, 'index.html'), 'utf8')).toContain('Agent Web');
  });
});

function renderApp(agentCatalog: AgentCatalogPort) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.add(root);
  act(() => root.render(<App agentCatalog={agentCatalog} />));

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      mountedRoots.delete(root);
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
