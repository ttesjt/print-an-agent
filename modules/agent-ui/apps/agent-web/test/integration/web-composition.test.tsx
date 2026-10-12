import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BrowserAgentWeb,
  createBrowserComposition,
} from '../../src/application/browser-composition.js';
import { readWorkspaceLocation, workspaceHash } from '@ta-agent/ui-workspace';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { engineConfig } from '../support/agent-config.js';
import { domEnvironment } from '../support/dom-environment.js';

const roots: Root[] = [];
const hosts: (() => Promise<void>)[] = [];
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  domEnvironment().setWindowSize({ width: 1280, height: 900 });
});
afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});
afterEach(async () => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  await act(async () => {
    await domEnvironment().waitUntilComplete();
  });
  await Promise.all(hosts.splice(0).map((close) => close()));
});
function mount(ports = createBrowserComposition('http://localhost/?mode=deterministic').ports) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      <BrowserAgentWeb ports={ports} profileLabel="Qualification" creationConfig={engineConfig()} />
    )
  );
  return root;
}
function click(label: string, scope: ParentNode = document) {
  const element = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label
  );
  if (element === undefined) throw new Error(`Missing ${label}`);
  act(() => element.click());
}
function input(label: string, value: string) {
  const scope = document.querySelector('dialog[open]') ?? document;
  const field = [...scope.querySelectorAll('label')].find(
    (entry) => entry.textContent?.replace(/\*/gu, '').trim() === label
  );
  const element =
    document.getElementById(field?.htmlFor ?? '') ?? field?.querySelector('input, textarea');
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
    throw new Error(`Missing ${label} control`);
  act(() => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (check()) return;
  }
  throw new Error(`UI did not settle: ${document.body.textContent ?? ''}`);
}

describe('browser application composition', () => {
  it('defaults to local ports, requires explicit fixture mode and validates URL targets', () => {
    expect(createBrowserComposition('http://localhost/').label).toBe('Local Agent Base');
    expect(createBrowserComposition('http://localhost/?mode=deterministic').label).toBe(
      'Deterministic fixtures'
    );
    expect(() => createBrowserComposition('http://localhost/?mode=unknown')).toThrow();
    expect(readWorkspaceLocation('#agent=a&session=s')).toEqual({ agentId: 'a', sessionId: 's' });
    expect(workspaceHash({ agentId: 'a', sessionId: 's' })).toBe('#agent=a&session=s');
    expect(() => readWorkspaceLocation('#session=s')).toThrow();
    expect(() => readWorkspaceLocation('#agent=a&agent=b')).toThrow();
    expect(() => readWorkspaceLocation('#agent=a&provider=secret')).toThrow();
  });

  it('runs empty → create → chat → persisted history with actual localhost backend and restores its target', async () => {
    const server = await startLocalAgentWebServer({
      ports: createAgentBaseWebPorts({
        engine: createOfflineWebEngine(),
        persistence: { kind: 'memory' },
      }),
    });
    hosts.push(server.close);
    domEnvironment().setURL(server.origin);
    const ports = createHttpAgentWebPorts({ baseUrl: `${server.origin}/api` });
    let root = mount(ports);
    await until(() => document.body.textContent?.includes('No Agents') === true);
    click('Create Agent');
    input('Agent ID', 'browser');
    input('Display name', 'Browser Agent');
    const dialog = document.querySelector('dialog[open]');
    if (dialog === null) throw new Error('Missing create dialog');
    click('Create Agent', dialog);
    await until(() => document.querySelector('[data-slot="agent-details"]') !== null);
    click('New');
    input('Message', 'Hello from UI');
    await until(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent?.trim() === 'Send' && !button.disabled
      )
    );
    click('Send');
    await until(() => document.body.textContent?.includes('Offline reply: Hello from UI') === true);
    expect(document.body.textContent).toContain('Thought process');
    await until(() => window.location.hash.includes('session='));
    const savedHash = window.location.hash;
    await act(async () => {
      await domEnvironment().waitUntilComplete();
    });
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    document.body.replaceChildren();
    root = mount(ports);
    await until(() => document.body.textContent?.includes('Offline reply: Hello from UI') === true);
    expect(window.location.hash).toBe(savedHash);
    click('Agent Profile');
    input('Instructions', 'Updated browser instructions');
    click('Save configuration');
    await until(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Save configuration' && button.disabled
      )
    );
    await act(async () => {
      const updated = await ports.agents.readAgentConfig({ agentId: 'browser' });
      if (updated.status !== 'succeeded') throw new Error('Config was not saved');
      expect(updated.value.value.instructions).toBe('Updated browser instructions');
    });
    click('Conversation');
    click('Session details');
    click('Rename');
    input('Session title', 'Recovered conversation');
    click('Rename Session');
    await until(() => document.body.textContent?.includes('Recovered conversation') === true);
    expect(window.location.hash).toBe(savedHash);
    click('Agent Profile');
    click('Disable Agent');
    const disableDialog = document.querySelector('dialog[open]');
    if (disableDialog === null) throw new Error('Missing disable dialog');
    click('Disable Agent', disableDialog);
    await until(
      () =>
        document.querySelector('[data-slot="agent-details"]')?.textContent?.includes('Disabled') ===
        true
    );
    click('Conversation');
    await until(
      () =>
        document
          .querySelector('[data-slot="conversation-composer"]')
          ?.getAttribute('data-state') === 'disabled'
    );
    expect(document.body.textContent).toContain('Offline reply: Hello from UI');
    click('Agent Profile');
    click('Reactivate Agent');
    await until(
      () =>
        document
          .querySelector('[data-slot="agent-details"]')
          ?.textContent?.includes('StatusActive') === true
    );
    click('Conversation');
    await until(
      () =>
        document
          .querySelector('[data-slot="conversation-composer"]')
          ?.getAttribute('data-state') === 'idle'
    );
    const theme = document.querySelector<HTMLSelectElement>('select[aria-label="Theme"]');
    if (theme === null) throw new Error('Missing Theme');
    act(() => {
      theme.value = 'dark';
      theme.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.documentElement.getAttribute('data-ta-ui-theme')).toBe('dark');
    expect(window.localStorage.getItem('ta-ui-agent-web-theme')).toBe('dark');
    await act(async () => {
      await domEnvironment().waitUntilComplete();
    });
  });

  it('shows an actionable offline state and retries against the same ports', async () => {
    let available = false;
    const fixtures = createBrowserComposition('http://localhost/?mode=deterministic').ports;
    mount({
      ...fixtures,
      agents: {
        ...fixtures.agents,
        listAgents: (input) =>
          available
            ? fixtures.agents.listAgents(input)
            : Promise.resolve({
                status: 'failed',
                failure: { code: 'unavailable', message: 'Local host offline.' },
              }),
      },
    });
    await until(() => document.body.textContent?.includes('Local host offline.') === true);
    available = true;
    click('Retry');
    await until(() => document.body.textContent?.includes('Research Assistant') === true);
  });

  it('maps unavailable and malformed RPC responses to safe errors without swallowing cancellation', async () => {
    for (const fetch of [
      () => Promise.reject(new Error('private credentials or storage path')),
      () =>
        Promise.resolve(
          new Response('{"status":"success","value":"wrong shape"}', {
            headers: { 'Content-Type': 'application/json' },
          })
        ),
    ]) {
      const ports = createHttpAgentWebPorts({ fetch });
      const result = await ports.agents.listAgents();
      expect(result.status).toBe('failed');
      expect(JSON.stringify(result)).not.toContain('private credentials');
    }
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    await expect(
      createHttpAgentWebPorts().agents.listAgents({ signal: controller.signal })
    ).rejects.toThrow('caller cancelled');
  });

  it('applies URL back/forward selection without remounting the application', async () => {
    mount();
    await until(() => document.body.textContent?.includes('Research Assistant') === true);
    act(() => {
      window.history.pushState(null, '', '/#agent=review-assistant&view=settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await until(
      () =>
        document
          .querySelector('[data-slot="agent-details"]')
          ?.textContent?.includes('review-assistant') === true
    );
    act(() => {
      window.history.pushState(null, '', '/#agent=research-assistant&view=settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await until(
      () =>
        document
          .querySelector('[data-slot="agent-details"]')
          ?.textContent?.includes('research-assistant') === true
    );
    expect(document.querySelectorAll('[data-slot="app-shell"]')).toHaveLength(1);
  });

  it('contains only browser transport/UI code in the production client bundle', () => {
    const assets = join(import.meta.dirname, '../../dist/public/assets');
    const script = readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assets, name), 'utf8'))
      .join('\n');
    expect(script).toContain('/commands');
    expect(script).toContain('/interactions');
    for (const privateMarker of [
      '@earendil-works',
      'node:sqlite',
      'OPENAI_API_KEY',
      'CREATE TABLE',
      'loadWebProviderRuntime',
      'createAgentBaseWebPorts',
    ])
      expect(script).not.toContain(privateMarker);
  });

  it('separates Profile from conversation and New immediately exposes a focused composer', async () => {
    mount();
    await until(
      () =>
        document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
    );
    expect(document.querySelector('#settings-instructions')).toBeNull();
    click('Agent Profile');
    expect(document.querySelector('#settings-instructions')).not.toBeNull();
    expect(document.querySelector('[data-slot="conversation-composer"]')).toBeNull();
    expect(window.location.hash).toContain('view=settings');
    click('New');
    await until(() => document.activeElement?.getAttribute('aria-label') === 'Message');
    expect(window.location.hash).toContain('view=conversation');
    expect(document.querySelector('#settings-instructions')).toBeNull();
    expect(document.querySelector('[data-slot="app-shell-inspector"]')).toBeNull();
    expect(document.querySelector('[data-session-draft]')).not.toBeNull();
  });

  it('guards unsaved configuration and reconciles a rejected browser navigation', async () => {
    mount();
    await until(
      () =>
        document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
    );
    click('Agent Profile');
    input('Instructions', 'Unsaved edits');
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    click('New');
    expect(document.querySelector('dialog[open]')?.textContent).toContain('Unsaved Agent changes');
    click('Keep editing');
    expect(document.querySelector<HTMLTextAreaElement>('#settings-instructions')?.value).toBe(
      'Unsaved edits'
    );
    const originalHash = window.location.hash;
    act(() => {
      window.history.pushState(null, '', '/#agent=review-assistant&view=settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await until(
      () =>
        document.querySelector('dialog[open]')?.textContent?.includes('Unsaved Agent changes') ===
        true
    );
    click('Keep editing');
    expect(window.location.hash).toBe(originalHash);
    expect(document.querySelector('[data-slot="agent-details"]')?.textContent).toContain(
      'research-assistant'
    );
    click('New');
    click('Discard and continue');
    await until(() => document.querySelector('[data-slot="conversation-composer"]') !== null);
    click('Agent Profile');
    expect(document.querySelector<HTMLTextAreaElement>('#settings-instructions')?.value).toBe(
      'Research carefully and cite evidence.'
    );
  });

  it('renames Agent metadata with CAS and reloads a conflict without altering ID/config', async () => {
    const fixtures = createBrowserComposition('http://localhost/?mode=deterministic').ports;
    mount(fixtures);
    await until(
      () =>
        document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
    );
    click('Agent Profile');
    input('Display name', 'Renamed research');
    click('Save display name');
    await until(
      () =>
        document
          .querySelector('[data-slot="app-shell-header"]')
          ?.textContent?.includes('Renamed research') === true
    );
    const inspected = await fixtures.agents.inspectAgent({ agentId: 'research-assistant' });
    if (inspected.status !== 'succeeded') throw new Error('Missing Agent');
    expect(inspected.value.details.agentId).toBe('research-assistant');
    expect(inspected.value.config.revision).toBe('revision-1');
    await fixtures.agents.renameAgent({
      agentId: 'research-assistant',
      displayName: 'External name',
      expectedRevision: inspected.value.details.identityRevision,
    });
    input('Display name', 'Stale local name');
    click('Save display name');
    await until(
      () =>
        document.querySelector('main')?.textContent?.includes('Reload current identity') === true
    );
    click('Reload current identity');
    await until(
      () =>
        document.querySelector<HTMLInputElement>('#profile-display-name')?.value === 'External name'
    );
    expect(document.querySelector('#settings-instructions')).not.toBeNull();
  });

  it('discards unsaved edits when an external same-Agent route is accepted', async () => {
    window.history.replaceState(null, '', '/#view=settings');
    mount();
    await until(() => document.querySelector('#settings-instructions') !== null);
    input('Instructions', 'Never saved');
    input('Display name', 'Never saved name');
    act(() => {
      window.history.pushState(null, '', '/#agent=research-assistant&view=conversation');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await until(() => document.querySelector('dialog[open]') !== null);
    click('Discard and continue');
    await until(() => document.querySelector('[data-slot="conversation-composer"]') !== null);
    click('Agent Profile');
    expect(document.querySelector<HTMLTextAreaElement>('#settings-instructions')?.value).toBe(
      'Research carefully and cite evidence.'
    );
    expect(document.querySelector<HTMLInputElement>('#profile-display-name')?.value).toBe(
      'Research Assistant'
    );
  });

  it('uses a modal Drawer for narrow Session details without taking Composer layout space', async () => {
    const setSize = (width: number) => domEnvironment().setWindowSize({ width, height: 844 });
    setSize(390);
    try {
      mount();
      await until(() => document.querySelector('[data-slot="conversation-composer"]') !== null);
      click('Session details');
      expect(document.querySelector('dialog[data-slot="drawer"][open]')).not.toBeNull();
      expect(document.querySelector('[data-slot="app-shell-inspector"]')).toBeNull();
      click('Close Session details');
      await until(() => document.querySelector('dialog[data-slot="drawer"][open]') === null);
      expect(document.querySelector('[data-slot="conversation-composer"]')).not.toBeNull();
    } finally {
      act(() => setSize(1280));
    }
  });
});
