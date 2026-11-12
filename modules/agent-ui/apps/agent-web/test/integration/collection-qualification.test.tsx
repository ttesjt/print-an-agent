import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defineActorEngine, type ActorEngine } from '@print-an-agent/model-invocation-core';
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { LocalCollectionApplication } from '../../src/application/collection-composition.js';
import { createDirectoryCollectionHost } from '../../src/node/collections/directory-host.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createDirectoryCollectionAccess } from '../../src/adapters/directory-collection-access.js';
import {
  createBrowserCollectionHistory,
  RECENT_COLLECTION_STORAGE_KEY,
} from '../../src/adapters/browser-collection-history.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { engineConfig } from '../support/agent-config.js';
import { domEnvironment } from '../support/dom-environment.js';
import { collectionHash } from '@print-an-agent/ui-workspace';

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const roots: Root[] = [];
const cleanup: (() => Promise<void>)[] = [];
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});
afterEach(async () => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  await act(() => domEnvironment().waitUntilComplete());
  for (const finish of cleanup.splice(0).reverse()) await finish();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
async function fixture(engine: ActorEngine = createOfflineWebEngine(), initial = false) {
  const directory = await mkdtemp(join(tmpdir(), 'collection-ui-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const options = { engine, ...(initial ? { initialRoot: join(directory, 'alpha') } : {}) };
  const collections = await createDirectoryCollectionHost(options);
  const signal = new AbortController().signal;
  for (const label of ['alpha', 'beta']) {
    const result = await collections.open({ rootDirectory: join(directory, label) }, signal);
    if (!result.ok) throw new Error(result.message);
    const ports = collections.resolve(result.collection.key);
    if (ports === undefined) throw new Error('Missing binding');
    const created = await ports.agents.createAgent({
      identity: { agentId: 'same-agent', displayName: `Agent ${label}` },
      config: engineConfig(engine.id),
    });
    if (created.status !== 'succeeded') throw new Error('Missing fixture Agent');
  }
  const server = await startLocalAgentWebServer({ collections });
  cleanup.push(server.close);
  domEnvironment().setURL(server.origin);
  return {
    directory,
    collections,
    server,
    access: createDirectoryCollectionAccess(`${server.origin}/api`),
    engine,
  };
}
function mount(
  access: ReturnType<typeof createDirectoryCollectionAccess>,
  history = createBrowserCollectionHistory()
) {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  act(() => root.render(<LocalCollectionApplication access={access} history={history} />));
  return root;
}
function unmount(root: Root) {
  act(() => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  document.body.replaceChildren();
}
function click(label: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label
  );
  if (button === undefined) throw new Error(`Missing ${label}`);
  act(() => button.click());
}
function input(label: string, value: string) {
  const field = [...document.querySelectorAll('label')].find(
    (entry) => entry.textContent?.replace(/\*/gu, '').trim() === label
  );
  const control =
    document.getElementById(field?.htmlFor ?? '') ?? field?.querySelector('input, textarea');
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement))
    throw new Error(`Missing ${label}`);
  act(() => {
    Object.getOwnPropertyDescriptor(
      control instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype,
      'value'
    )?.set?.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function until(check: () => boolean) {
  for (let index = 0; index < 120; index++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (check()) return;
  }
  throw new Error(document.body.textContent ?? 'Not settled');
}
async function choose(path: string) {
  await until(() => document.querySelector('[data-slot="collection-setup"]') !== null);
  input('Collection directory', path);
  click('Open Collection');
  await until(
    () => document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
  );
}

it('qualifies directory selection, live reasoning, saved history and a URL restore after host restart', async () => {
  const { directory, access, server, engine } = await fixture();
  let root = mount(access);
  await choose(join(directory, 'alpha'));
  input('Message', 'Collection-qualified message');
  click('Send');
  await until(
    () =>
      document.body.textContent?.includes('Offline reply: Collection-qualified message') === true
  );
  await until(() => window.location.hash.includes('session='));
  await until(() => document.querySelector('[data-conversation-turn-actions]') !== null);
  const saved = window.location.hash;
  expect(document.body.textContent).toContain('Thought process');
  await until(
    () => window.localStorage.getItem(RECENT_COLLECTION_STORAGE_KEY)?.includes('alpha') === true
  );
  unmount(root);
  await server.close();
  const restarted = await startLocalAgentWebServer({
    collections: await createDirectoryCollectionHost({ engine }),
    port: Number(new URL(server.origin).port),
  });
  cleanup.push(restarted.close);
  domEnvironment().setURL(`${restarted.origin}/${saved}`);
  root = mount(createDirectoryCollectionAccess(`${restarted.origin}/api`));
  await until(
    () =>
      document.body.textContent?.includes('Offline reply: Collection-qualified message') === true
  );
  expect(window.location.hash).toBe(saved);
  expect(document.body.textContent).toContain('Thought process');
  unmount(root);
});

it('protects unsaved edits and composer drafts and switches identical identities into fresh scopes', async () => {
  const { directory, access } = await fixture();
  mount(access);
  await choose(join(directory, 'alpha'));
  click('Agent Profile');
  await until(() =>
    [...document.querySelectorAll('label')].some((entry) => entry.textContent === 'Instructions*')
  );
  input('Instructions', 'Unsaved alpha edit');
  click('Collections');
  expect(document.querySelector('dialog[open]')?.textContent).toContain('Leave this Collection?');
  click('Keep editing', document.querySelector('dialog[open]') ?? document);
  expect(document.body.textContent).toContain('Agent alpha');
  click('Collections');
  click('Discard and leave', document.querySelector('dialog[open]') ?? document);
  await choose(join(directory, 'beta'));
  expect(document.body.textContent).toContain('Agent beta');
  expect(document.body.textContent).not.toContain('Agent alpha');
  input('Message', 'Unsent beta draft');
  click('Collections');
  expect(document.querySelector('dialog[open]')?.textContent).toContain('Leave this Collection?');
  click('Discard and leave', document.querySelector('dialog[open]') ?? document);
  await choose(join(directory, 'alpha'));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
});

it('blocks UI and external Collection navigation during active work, then permits it after cancellation', async () => {
  let cancelled = false;
  const engine = defineActorEngine({
    ...createOfflineWebEngine(),
    interact: async ({ signal }) => {
      return await new Promise<never>((_resolve, reject) => {
        const cancel = () => {
          cancelled = true;
          reject(signal.reason instanceof Error ? signal.reason : new Error('Cancelled'));
        };
        if (signal.aborted) cancel();
        else signal.addEventListener('abort', cancel, { once: true });
      });
    },
  });
  const { directory, access } = await fixture(engine, true);
  mount(access);
  await until(
    () => document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
  );
  input('Message', 'Wait until cancelled');
  click('Send');
  await until(() =>
    [...document.querySelectorAll('button')].some(
      (entry) => entry.textContent === 'Cancel response'
    )
  );
  await until(() => window.location.hash.includes('session='));
  const hash = window.location.hash;
  click('Collections');
  expect(document.body.textContent).toContain('Finish or cancel active work');
  expect(document.querySelector('[data-slot="collection-setup"]')).toBeNull();
  act(() => {
    window.location.hash = '#collections';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await until(() => window.location.hash === hash);
  click('Cancel response');
  await until(() => cancelled);
  await until(
    () =>
      ![...document.querySelectorAll('button')].some(
        (entry) => entry.textContent === 'Cancel response'
      )
  );
  click('Collections');
  await until(() => document.querySelector('[data-slot="collection-setup"]') !== null);
  expect(document.body.textContent).toContain('alpha');
  expect((await stat(join(directory, 'alpha', 'same-agent'))).isDirectory()).toBe(true);
});

it('does not auto-enter recent history and forget/clear never delete resources', async () => {
  const { directory, access } = await fixture();
  let root = mount(access);
  await choose(join(directory, 'alpha'));
  click('Collections');
  await until(() => document.querySelector('[data-slot="collection-list-item"]') !== null);
  unmount(root);
  window.history.replaceState(null, '', '/');
  root = mount(access);
  await until(() => document.querySelector('[data-slot="collection-setup"]') !== null);
  expect(document.querySelector('[data-slot="app-shell"]')).toBeNull();
  click('Forget');
  await until(() => document.querySelector('[data-slot="collection-list-item"]') === null);
  expect((await stat(join(directory, 'alpha', 'same-agent'))).isDirectory()).toBe(true);
  await choose(join(directory, 'beta'));
  click('Collections');
  await until(() => document.querySelector('[data-slot="collection-list-item"]') !== null);
  click('Clear recent Collections');
  await until(() => window.localStorage.getItem(RECENT_COLLECTION_STORAGE_KEY) === '[]');
  expect((await stat(join(directory, 'beta', 'same-agent'))).isDirectory()).toBe(true);
  unmount(root);
});

it('rechecks scope ownership when new edits begin during a delayed Collection opening', async () => {
  const { directory, access, collections } = await fixture();
  const beta = await collections.open(
    { rootDirectory: join(directory, 'beta') },
    new AbortController().signal
  );
  if (!beta.ok) throw new Error(beta.message);
  const history = createBrowserCollectionHistory();
  await history.saveRecentCollections([
    { collection: beta.collection, lastUsedAt: new Date().toISOString() },
  ]);
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  mount(
    {
      ...access,
      openCollection: async (request) => {
        if (request.reference.rootDirectory === beta.collection.reference.rootDirectory)
          await barrier;
        return access.openCollection(request);
      },
    },
    history
  );
  await choose(join(directory, 'alpha'));
  const originalHash = window.location.hash;
  act(() => {
    window.location.hash = collectionHash(beta.collection.key);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  try {
    await until(() => document.body.textContent?.includes('Opening Collection…') === true);
    input('Message', 'Keep this new alpha draft');
  } finally {
    release();
  }
  await until(() => document.body.textContent?.includes('resolve unsaved changes') === true);
  expect(document.body.textContent).toContain('Agent alpha');
  expect(window.location.hash).toBe(originalHash);
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
    'Keep this new alpha draft'
  );
});

it('continues opening and chatting when browser persistence is blocked', async () => {
  const { directory, access } = await fixture();
  mount(
    access,
    createBrowserCollectionHistory(() => {
      throw new Error('Storage disabled');
    })
  );
  await choose(join(directory, 'alpha'));
  input('Message', 'No cache required');
  click('Send');
  await until(
    () => document.body.textContent?.includes('Offline reply: No cache required') === true
  );
  await until(
    () => document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
  );
  click('Collections');
  await until(() => document.querySelector('[data-slot="collection-setup"]') !== null);
  expect(document.body.textContent).toContain('history could not be saved');
});
