import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { BrowserAgentWeb } from '../../src/application/browser-composition.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { providerServer } from '../support/provider-server.js';
import { domEnvironment } from '../support/dom-environment.js';

const roots: Root[] = [];
const cleanup: (() => Promise<void>)[] = [];
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  domEnvironment().setWindowSize({ width: 1280, height: 900 });
});
afterAll(() => {
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});
afterEach(async () => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  await act(async () => {
    await domEnvironment().waitUntilComplete();
  });
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const provider = await providerServer({ tools: false, responseText: 'Configured through UI' });
  cleanup.push(provider.close);
  const child = fork(resolve(import.meta.dirname, '../support/model-host.ts'), [], {
    env: { ...process.env, UI_FIXTURE_KEY: 'private-fixture-value' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  cleanup.push(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.send('close');
    await exited;
  });
  const startup = new AbortController();
  const timer = setTimeout(() => startup.abort(new Error('Host startup timed out')), 10000);
  let events: unknown;
  try {
    events = await once(child, 'message', { signal: startup.signal });
  } finally {
    clearTimeout(timer);
  }
  const message: unknown = Array.isArray(events) ? events[0] : undefined;
  if (
    typeof message !== 'object' ||
    message === null ||
    !('origin' in message) ||
    typeof message.origin !== 'string'
  )
    throw new Error('Host startup failed');
  const origin = message.origin;
  domEnvironment().setURL(origin);
  const ports = createHttpAgentWebPorts({ baseUrl: `${origin}/api` });
  const created = await ports.agents.createAgent({
    identity: { agentId: 'ui-config', displayName: 'UI Config' },
    config: DEFAULT_AGENT_CONFIG,
  });
  if (created.status !== 'succeeded') throw new Error('Fixture creation failed');
  const mount = () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(<BrowserAgentWeb ports={ports} profileLabel="Local qualification" />));
    return root;
  };
  mount();
  await until(
    () =>
      document.querySelector('#settings-instructions') !== null ||
      document.querySelector('[data-slot="conversation-composer"]') !== null
  );
  return { provider, ports, mount };
}
async function until(check: () => boolean) {
  for (let count = 0; count < 100; count++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (check()) return;
  }
  throw new Error(`UI did not settle: ${document.body.textContent ?? ''}`);
}
function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (button === undefined) throw new Error(`Missing ${label}`);
  act(() => button.click());
}
function setField(id: string, value: string) {
  const node = document.getElementById(id);
  if (
    !(
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement
    )
  )
    throw new Error(`Missing field ${id}`);
  const prototype =
    node instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : node instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
function toggle(label: string) {
  const node = [...document.querySelectorAll('label')]
    .find((candidate) => candidate.textContent?.trim() === label)
    ?.querySelector('input');
  if (node === undefined || node === null) throw new Error(`Missing checkbox ${label}`);
  act(() => node.click());
}
function save() {
  const form = document.querySelector('#settings-instructions')?.closest('form');
  if (form === null || form === undefined) throw new Error('Missing config form');
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('per-Agent configuration through browser forms and actual Pi transport', () => {
  it('blocks unconfigured interactions, saves all fields without a call, probes and chats through the saved binding', async () => {
    const { provider, ports } = await setup();
    await until(
      () =>
        document.querySelector('[data-slot="conversation-composer"][data-state="disabled"]') !==
        null
    );
    click('Open Agent Settings');
    await until(() => document.querySelector('#settings-model-kind') !== null);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    setField('settings-model-kind', 'openai-compatible');
    setField('settings-provider', 'local-fixture');
    setField('settings-model', 'fixture-ui');
    setField('settings-baseUrl', provider.baseUrl);
    setField('settings-contextWindowTokens', '4096');
    setField('settings-modelMaxOutputTokens', '256');
    toggle('Endpoint supports reasoning');
    toggle('Requires server credential');
    setField('settings-credentialRef', 'ui-credential');
    setField('settings-environmentVariable', 'UI_FIXTURE_KEY');
    setField('settings-temperature', '0.2');
    setField('settings-actorMaxOutputTokens', '128');
    setField('settings-requestTimeoutMilliseconds', '60000');
    setField('settings-actorTimeoutMilliseconds', '45000');
    setField('settings-responseStartTimeoutMilliseconds', '2000');
    setField('settings-streamEventIdleTimeoutMilliseconds', '2000');
    setField('settings-instructions', '   ');
    save();
    await until(
      () =>
        document.querySelector('#settings-instructions')?.getAttribute('aria-invalid') === 'true'
    );
    expect(provider.requests).toHaveLength(0);
    expect(
      document.querySelector('#settings-instructions')?.getAttribute('aria-describedby')
    ).toContain('error');
    setField('settings-instructions', 'UI configured instructions');
    save();
    await until(
      () =>
        document.body.textContent?.includes('Network connectivity has not been tested.') === true
    );
    expect(provider.requests).toHaveLength(0);
    const saved = await ports.agents.readAgentConfig({ agentId: 'ui-config' });
    expect(saved).toMatchObject({
      status: 'succeeded',
      value: {
        value: {
          model: {
            credential: { reference: 'ui-credential', environmentVariable: 'UI_FIXTURE_KEY' },
            config: {
              supportsReasoning: true,
              compatibility: { supportsDeveloperRole: false },
            },
          },
          invocation: { temperature: 0.2, maxOutputTokens: 128 },
          execution: {
            requestTimeoutMilliseconds: 60000,
            actorTimeoutMilliseconds: 45000,
            responseStartTimeoutMilliseconds: 2000,
            streamEventIdleTimeoutMilliseconds: 2000,
          },
        },
      },
    });
    click('Test saved connection');
    await until(() => document.body.textContent?.includes('Connection verified at') === true);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      messages: [{ role: 'system', content: 'UI configured instructions' }, { role: 'user' }],
    });
    const sessions = await ports.sessions.listSessions({ agentId: 'ui-config', status: 'active' });
    expect(sessions).toMatchObject({ status: 'succeeded', value: { records: [] } });
    expect(document.body.textContent).not.toContain('Configured through UI');
    click('New');
    await until(() => document.activeElement?.getAttribute('aria-label') === 'Message');
    const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="Message"]');
    if (composer === null) throw new Error('Missing Composer');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        composer,
        'Hello UI'
      );
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click('Send');
    await until(
      () =>
        document.querySelector('[data-slot="conversation-turn"][data-state="completed"]') !== null
    );
    expect(document.querySelector('main')?.textContent).toContain('Configured through UI');
    expect(document.querySelector('main')?.textContent).toContain('Thinking · model turn 1');
    expect(provider.authorization).toEqual([
      'Bearer private-fixture-value',
      'Bearer private-fixture-value',
    ]);
    expect(JSON.stringify(saved)).not.toContain('private-fixture-value');
    expect(document.body.textContent).not.toContain('private-fixture-value');
  });

  it('persists built-in catalog configuration and restores Profile with null defaults without calling a cloud API', async () => {
    const { provider, ports, mount } = await setup();
    click('Agent Profile');
    await until(() => document.querySelector('#settings-model-kind') !== null);
    setField('settings-model-kind', 'builtin');
    setField('settings-provider', 'openai');
    setField('settings-model', 'gpt-4o-mini');
    toggle('Requires server credential');
    setField('settings-credentialRef', 'cloud');
    setField('settings-environmentVariable', 'UI_FIXTURE_KEY');
    save();
    await until(
      () =>
        document.body.textContent?.includes('Network connectivity has not been tested.') === true
    );
    expect(provider.requests).toHaveLength(0);
    const saved = await ports.agents.readAgentConfig({ agentId: 'ui-config' });
    expect(saved).toMatchObject({
      status: 'succeeded',
      value: {
        value: {
          model: {
            config: { kind: 'builtin', reference: { provider: 'openai', model: 'gpt-4o-mini' } },
          },
          execution: DEFAULT_AGENT_CONFIG.execution,
        },
      },
    });
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.replaceChildren();
    mount();
    await until(
      () => document.querySelector<HTMLInputElement>('#settings-model')?.value === 'gpt-4o-mini'
    );
    expect(document.querySelector('#settings-supportsReasoning')).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('#settings-requestTimeoutMilliseconds')?.value
    ).toBe('');
    expect(document.querySelector('[data-slot="conversation-composer"]')).toBeNull();
    expect(provider.requests).toHaveLength(0);
    await until(
      () =>
        document.body.textContent?.includes('Network connectivity has not been tested.') === true
    );
  });
});
