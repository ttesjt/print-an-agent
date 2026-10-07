import { defineActorEngine, type ActorEngine } from '@ta-agent/base-actor';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BrowserAgentWeb } from '../../src/application/browser-composition.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { domEnvironment } from '../support/dom-environment.js';
import { engineConfig } from '../support/agent-config.js';
import type { AgentWebPorts } from '../../src/application/ports.js';
import type { AgentWebConfig } from '../../src/application/agent-config.js';

const roots: Root[] = [];
const hosts: (() => Promise<void>)[] = [];
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
  for (const close of hosts.splice(0)) await close();
});
async function mount(
  engine: ActorEngine = createOfflineWebEngine(),
  decorate: (ports: AgentWebPorts<AgentWebConfig>) => AgentWebPorts<AgentWebConfig> = (ports) =>
    ports
) {
  const backend = createAgentBaseWebPorts({ engine, persistence: { kind: 'memory' } });
  const created = await backend.agents.createAgent({
    identity: { agentId: 'session-sync', displayName: 'Session Sync' },
    config: engineConfig(),
  });
  if (created.status === 'failed') throw new Error('Fixture Agent creation failed');
  const host = await startLocalAgentWebServer({ ports: backend });
  hosts.push(host.close);
  domEnvironment().setURL(host.origin);
  const ports = decorate(createHttpAgentWebPorts({ baseUrl: `${host.origin}/api` }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<BrowserAgentWeb ports={ports} profileLabel="Session synchronization" />));
  await until(
    () => document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
  );
  return ports;
}
function button(label: string) {
  const value = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label
  );
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}
function click(label: string) {
  act(() => button(label).click());
}
function send(message = 'First message') {
  const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="Message"]');
  if (composer === null) throw new Error('Missing Composer');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      composer,
      message
    );
    composer.dispatchEvent(new Event('input', { bubbles: true }));
  });
  click('Send');
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

describe('Session catalog reconciliation without a page reload', () => {
  it('leaves Retired for a visible draft, then promotes the completed Session into the active list', async () => {
    await mount();
    click('Retired');
    await until(() => document.body.textContent?.includes('No retired Sessions.') === true);
    click('New');
    expect(button('Active').getAttribute('data-appearance')).toBe('solid');
    expect(document.querySelector('[data-session-draft-entry]')).not.toBeNull();
    send();
    await until(() => document.querySelector('[data-session-id][data-selected="true"]') !== null);
    expect(document.querySelector('[data-session-draft-entry]')).toBeNull();
    await until(
      () =>
        document
          .querySelector('[data-slot="session-list-item"]')
          ?.textContent?.includes('1 turns') === true
    );
    expect(window.location.hash).toContain('session=');
    await until(
      () =>
        document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
    );
  });

  it('publishes the durable Session while the first model response is still pending', async () => {
    const release = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const base = createOfflineWebEngine();
    const interact = base.interact;
    if (interact === undefined) throw new Error('Fixture interaction is unavailable');
    const engine = defineActorEngine({
      ...base,
      interact: async (request) => {
        entered.resolve();
        await waitForRelease(release.promise, request.signal);
        return interact(request);
      },
    });
    const ports = await mount(engine);
    try {
      send();
      const optimisticItem = document.querySelector('[data-submitted-conversation]');
      expect(optimisticItem?.classList.contains('ta-ui-session-list__item')).toBe(true);
      expect(optimisticItem?.textContent).toContain('Untitled Session');
      expect(optimisticItem?.textContent).toContain('Working');
      expect(optimisticItem?.hasAttribute('data-session-id')).toBe(false);
      expect(document.body.textContent).not.toContain('Starting conversation');
      expect(document.body.textContent).not.toContain('No active Sessions.');
      const optimisticButton = optimisticItem?.querySelector<HTMLButtonElement>('button');
      act(() => optimisticButton?.focus());
      await until(() => document.querySelector('[data-session-id][data-selected="true"]') !== null);
      await entered.promise;
      const admittedItem = document.querySelector('[data-session-id][data-selected="true"]');
      expect(admittedItem).toBe(optimisticItem);
      expect(document.activeElement).toBe(optimisticButton);
      expect(document.querySelector('[data-submitted-conversation]')).toBeNull();
      expect(document.querySelector('[data-session-draft-entry]')).toBeNull();
      expect(window.location.hash).toContain('session=');
      expect(
        document.querySelector('[data-slot="conversation-turn"][data-state="completed"]')
      ).toBeNull();
      await act(async () => {
        const page = await ports.sessions.listSessions({
          agentId: 'session-sync',
          status: 'active',
        });
        expect(page).toMatchObject({
          status: 'succeeded',
          value: { records: [expect.objectContaining({ turnCount: 1 })] },
        });
      });
      expect(document.querySelector('[data-slot="session-list-item"]')?.textContent).toContain(
        'Working'
      );
    } finally {
      act(() => release.resolve());
      await until(
        () =>
          document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
      );
    }
  });

  it.each(['complete', 'cancel-second'] as const)(
    'isolates two newly admitted conversations: %s',
    async (outcome) => {
      const releases = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      const signals: AbortSignal[] = [];
      const base = createOfflineWebEngine();
      const interact = base.interact;
      if (interact === undefined) throw new Error('Fixture interaction is unavailable');
      const engine = defineActorEngine({
        ...base,
        interact: async (request) => {
          const index = signals.length;
          signals.push(request.signal);
          const release = releases[index];
          if (release === undefined) throw new Error('Unexpected model call');
          await waitForRelease(release.promise, request.signal);
          return interact(request);
        },
      });
      const ports = await mount(engine);
      try {
        send('First concurrent message');
        await until(
          () =>
            signals.length === 1 &&
            document.querySelector('[data-session-id][data-selected="true"]') !== null
        );
        const firstSessionHash = window.location.hash;
        const firstItem = document.querySelector('[data-session-id][data-selected="true"]');
        if (firstItem === null) throw new Error('Missing first Session');
        click('New');
        send('Second concurrent message');
        await until(
          () =>
            signals.length === 2 &&
            document.querySelectorAll('[data-session-id]').length === 2 &&
            document.querySelector('[data-session-id][data-selected="true"]') !== null &&
            document.querySelector('main')?.textContent?.includes('Second concurrent message') ===
              true
        );
        expect(signals.every((signal) => !signal.aborted)).toBe(true);
        const secondSessionHash = window.location.hash;
        expect(secondSessionHash).not.toBe(firstSessionHash);
        expect(document.querySelector('main')?.textContent).toContain('Second concurrent message');
        if (outcome === 'cancel-second') {
          click('Cancel response');
          await until(() => signals[1]?.aborted === true);
          expect(signals[0]?.aborted).toBe(false);
        } else {
          act(() => releases[1]?.resolve());
          await until(
            () =>
              document.querySelector('[data-slot="conversation-turn"][data-state="completed"]') !==
              null
          );
        }
        act(() => releases[0]?.resolve());
        await until(
          () =>
            document.querySelector('[data-slot="session-list-item"][data-working="true"]') === null
        );
        expect(window.location.hash).toBe(secondSessionHash);
        const firstButton = firstItem.querySelector<HTMLButtonElement>('button');
        if (firstButton === null) throw new Error('Missing first Session action');
        expect(firstButton.isConnected).toBe(true);
        act(() => firstButton.click());
        await until(
          () =>
            document
              .querySelector('main')
              ?.textContent?.includes('Offline reply: First concurrent message') === true
        );
        expect(
          document.querySelector('[data-slot="conversation-turn"][data-state="failed"]')
        ).toBeNull();
        await act(async () => {
          const page = await ports.sessions.listSessions({
            agentId: 'session-sync',
            status: 'active',
          });
          expect(page.status).toBe('succeeded');
          if (page.status === 'succeeded') expect(page.value.records).toHaveLength(2);
        });
      } finally {
        act(() => {
          for (const release of releases) release.resolve();
        });
        await until(
          () =>
            document.querySelector('[data-slot="session-list-item"][data-working="true"]') === null
        );
      }
    }
  );

  it.each([false, true])(
    'retains submitted ownership before admission delivery (select canonical early: %s)',
    async (selectEarly) => {
      const modelRelease = Promise.withResolvers<void>();
      const admissionRelease = Promise.withResolvers<void>();
      const admissionReceived = Promise.withResolvers<string>();
      const signals: AbortSignal[] = [];
      const base = createOfflineWebEngine();
      const interact = base.interact;
      if (interact === undefined) throw new Error('Fixture interaction is unavailable');
      const engine = defineActorEngine({
        ...base,
        interact: async (request) => {
          signals.push(request.signal);
          await waitForRelease(modelRelease.promise, request.signal);
          return interact(request);
        },
      });
      let calls = 0;
      await mount(engine, (ports) => ({
        ...ports,
        conversations: {
          ...ports.conversations,
          streamInteraction: (input, consume) => {
            const first = ++calls === 1;
            return ports.conversations.streamInteraction(input, async (event) => {
              if (first && event.type === 'session-admitted') {
                admissionReceived.resolve(event.admission.details.sessionId);
                await admissionRelease.promise;
              }
              await consume(event);
            });
          },
        },
      }));
      try {
        send('First delayed admission');
        const optimisticItem = document.querySelector('[data-submitted-conversation]');
        expect(optimisticItem?.classList.contains('ta-ui-session-list__item')).toBe(true);
        expect(optimisticItem?.textContent).toBe('Untitled SessionWorking');
        expect(document.body.textContent).not.toContain('Starting conversation');
        expect(document.body.textContent).not.toContain('No active Sessions.');
        let firstId = '';
        await act(async () => {
          firstId = await admissionReceived.promise;
        });
        click('New');
        send('Second foreground conversation');
        await until(
          () =>
            signals.length === 2 &&
            window.location.hash.includes('session=') &&
            document.querySelectorAll('[data-session-id]').length === 2
        );
        const foregroundHash = window.location.hash;
        if (selectEarly) {
          // The catalog may discover the canonical Session before its held stream notification.
          const firstButton = document
            .querySelector(`[data-session-id="${firstId}"]`)
            ?.querySelector<HTMLButtonElement>('button');
          if (firstButton === undefined || firstButton === null)
            throw new Error('Missing early Session action');
          act(() => firstButton.click());
          await until(
            () =>
              window.location.hash.includes(firstId) &&
              document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !==
                null
          );
        }
        act(() => admissionRelease.resolve());
        await until(
          () =>
            signals.length === 2 &&
            document.querySelectorAll('[data-slot="session-list-item"][data-working="true"]')
              .length === 2
        );
        expect(signals.every((signal) => !signal.aborted)).toBe(true);
        if (selectEarly) {
          expect(window.location.hash).toContain(firstId);
          expect(document.querySelector('main')?.textContent).toContain('First delayed admission');
        } else {
          expect(window.location.hash).toBe(foregroundHash);
          expect(document.querySelector('main')?.textContent).toContain(
            'Second foreground conversation'
          );
        }
        expect(document.querySelector('[data-session-draft-entry]')).toBeNull();
        expect(document.querySelector('[data-submitted-conversation]')).toBeNull();
        expect(document.querySelector(`[data-session-id="${firstId}"]`)).toBe(optimisticItem);
      } finally {
        act(() => {
          admissionRelease.resolve();
          modelRelease.resolve();
        });
        await until(
          () =>
            document.querySelector('[data-slot="session-list-item"][data-working="true"]') === null
        );
      }
    }
  );

  it.each(['failed', 'cancelled'] as const)(
    'discovers the backend Session after a %s first response, without declaring success',
    async (terminal) => {
      const engine = defineActorEngine({
        ...createOfflineWebEngine(),
        interact: async ({ emit, signal }) => {
          await emit({ type: 'turn-start' });
          await emit({ type: 'text-delta', delta: 'Partial first response' });
          if (terminal === 'cancelled') {
            signal.throwIfAborted();
            await new Promise<never>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('Fixture interaction cancelled.', 'AbortError')),
                { once: true }
              );
            });
          }
          throw new Error('Fixture first response failed');
        },
      });
      const ports = await mount(engine);
      send();
      await until(
        () =>
          document
            .querySelector('[data-slot="assistant-message"]')
            ?.textContent?.includes('Partial first response') === true
      );
      if (terminal === 'cancelled') click('Cancel response');
      await until(
        () =>
          document.querySelector(`[data-slot="conversation-turn"][data-state="${terminal}"]`) !==
          null
      );
      await until(() => document.querySelector('[data-slot="session-list-item"]') !== null);
      expect(
        document.querySelector('[data-slot="conversation-turn"][data-state="completed"]')
      ).toBeNull();
      expect(document.querySelector('main')?.textContent).toContain('Partial first response');
      const page = await ports.sessions.listSessions({ agentId: 'session-sync', status: 'active' });
      expect(page).toMatchObject({ status: 'succeeded', value: { records: [expect.any(Object)] } });
    }
  );
});

async function waitForRelease(release: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const cancellation = Promise.withResolvers<never>();
  const abort = () => cancellation.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([release, cancellation.promise]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
  signal.throwIfAborted();
}
