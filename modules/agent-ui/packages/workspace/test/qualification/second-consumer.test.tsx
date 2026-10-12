import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type {
  CollectionAccessPort,
  CollectionOpenResult,
  ConversationPage,
} from '@ta-agent/ui-contracts';
import {
  AgentWorkspace,
  CollectionApplication,
  collectionHash,
  type CollectionConnection,
} from '@ta-agent/ui-workspace';
import {
  qualifyWorkspaceCatalog,
  qualifyWorkspaceInteraction,
} from '@ta-agent/ui-workspace/testing';
import { deferred, researchBackend, type ResearchReference } from './research-backend.js';
import { researchExtension } from './research-extension.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});
async function settle() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    await settle();
    if (check()) return;
  }
  throw new Error(document.body.textContent ?? 'UI did not settle');
}
async function render(element: React.ReactNode) {
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  act(() => root?.render(element));
  await settle();
}
function button(text: string) {
  const element = [...document.querySelectorAll('button')].find(
    (e) => e.textContent?.trim() === text
  );
  if (!element) throw new Error(`Missing button ${text}: ${document.body.textContent}`);
  return element;
}
function click(text: string) {
  act(() => button(text).click());
}
function edit(selector: string, value: string) {
  const e = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!e) throw new Error(`Missing ${selector}`);
  act(() => {
    const proto =
      e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(e, value);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function connection(backend: ReturnType<typeof researchBackend>): CollectionConnection {
  return {
    ports: backend.ports,
    profileLabel: backend.collection.label,
    extension: researchExtension(backend),
  };
}

it('consumes the whole public workspace with pagination, independent product settings and absent capabilities', async () => {
  const backend = researchBackend();
  const c = connection(backend);
  expect((await qualifyWorkspaceCatalog(backend.ports)).map((a) => a.agentId)).toEqual([
    'alpha',
    'beta',
  ]);
  await render(
    <AgentWorkspace {...c} requestedLocation={{ agentId: 'alpha', view: 'settings' }} />
  );
  await until(() => document.querySelector('#research-datasets') !== null);
  expect(document.body.textContent).not.toContain('Disable Agent');
  expect(document.body.textContent).not.toContain('Test model connection');
  click('Load more Agents');
  await until(() => document.body.textContent?.includes('Research beta') === true);
  edit('#research-datasets', 'new collection');
  edit('#research-region', 'east');
  const saving = deferred<Awaited<ReturnType<typeof backend.savePreferences>>>();
  backend.controls.preferenceSave = saving;
  click('Save datasets');
  await settle();
  expect(button('Save compute').disabled).toBe(false);
  edit('#research-datasets', 'newer local edits');
  click('Save compute');
  await until(() => document.body.textContent?.includes('Compute allocation unavailable') === true);
  await act(async () => {
    saving.resolve({
      status: 'committed',
      value: {
        revision: 'preferences:4',
        value: { datasets: ['new collection'], strategy: 'guided' },
      },
      notices: [{ code: 'refresh-failed', message: 'Saved; search index needs refresh' }],
    });
    await Promise.resolve();
  });
  expect(document.querySelector<HTMLInputElement>('#research-datasets')?.value).toBe(
    'newer local edits'
  );
  expect(document.body.textContent).toContain('preferences:4');
  expect(document.body.textContent).toContain('pool:9');
  expect(document.body.textContent).toContain('Saved; search index needs refresh');
  expect(document.body.textContent).toContain('Compute allocation unavailable');
});

it('treats creation as committed even when preparation failed; no second identity is created', async () => {
  const backend = researchBackend();
  await render(<AgentWorkspace {...connection(backend)} />);
  await until(() => document.querySelector('[data-slot="conversation-composer"]') !== null);
  click('Create Agent');
  await settle();
  click('Provision research Agent');
  await until(
    () => document.body.textContent?.includes('Created; dataset preparation failed') === true
  );
  expect(document.body.textContent).toContain('Research gamma');
  expect((await qualifyWorkspaceCatalog(backend.ports)).map((a) => a.agentId)).toEqual([
    'alpha',
    'beta',
    'gamma',
  ]);
});

it('owns admission, parallel interactions, navigation and recovery while history remains pending', async () => {
  const backend = researchBackend();
  await render(<AgentWorkspace {...connection(backend)} />);
  await until(() => document.querySelector('[data-slot="conversation-composer"]') !== null);
  edit('textarea', 'first');
  click('Send');
  await until(() => backend.runs.size === 1);
  const first = [...backend.runs.keys()][0]!;
  click('New');
  await settle();
  edit('textarea', 'second');
  click('Send');
  await until(() => backend.runs.size === 2);
  const second = [...backend.runs.keys()].find((id) => id !== first)!;
  await act(() => backend.finish(first));
  expect(backend.runs.has(second)).toBe(true);
  const history = deferred<ConversationPage>();
  backend.controls.historyRead = history;
  await act(() => backend.finish(second, true));
  await until(
    () => document.body.textContent?.includes('Saved; projection needs recovery') === true
  );
  expect(document.body.textContent).toContain('Answer second');
  click('Reload saved response');
  await settle();
  expect(document.body.textContent).toContain('Answer second');
  expect(button('Send').textContent).toBe('Send');
  expect(document.body.textContent).not.toContain('Fork from here');
  await act(async () => {
    history.resolve({ turns: backend.turns.get(second) ?? [] });
    await Promise.resolve();
  });
  await until(() => !document.body.textContent?.includes('Saved; projection needs recovery'));
  expect(backend.controls.calls).toBe(2);
});

it('protects newer product edits while an authorised cross-Collection opening is pending', async () => {
  const a = researchBackend('one'),
    b = researchBackend('two');
  const ca = connection(a),
    cb = connection(b);
  const opening = deferred<CollectionOpenResult<CollectionConnection, ResearchReference>>();
  const access: CollectionAccessPort<CollectionConnection, ResearchReference> = {
    openCollection: ({ reference }) =>
      reference.tenant === 'one'
        ? Promise.resolve({ ok: true, collection: a.collection, connection: ca })
        : opening.promise,
  };
  await render(
    <CollectionApplication
      access={access}
      reference={a.collection.reference}
      fields={<p>Tenant and notebook locator</p>}
      choices={[a.collection, b.collection]}
      resolveReference={(key) =>
        Promise.resolve(key === 'two' ? b.collection.reference : a.collection.reference)
      }
      initialCollection={a.collection}
    />
  );
  await until(() => document.body.textContent?.includes('Research alpha') === true);
  click('Agent Profile');
  await settle();
  edit('#research-datasets', 'old draft');
  act(() => {
    window.location.hash = collectionHash('two');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await until(() => document.body.textContent?.includes('Discard and leave') === true);
  click('Discard and leave');
  await settle();
  edit('#research-datasets', 'new edit after authorisation');
  await act(async () => {
    opening.resolve({ ok: true, collection: b.collection, connection: cb });
    await Promise.resolve();
  });
  expect(window.location.hash).toContain('one');
  expect(document.querySelector<HTMLInputElement>('#research-datasets')?.value).toBe(
    'new edit after authorisation'
  );
});

it('offers a common stream qualification entry without importing application internals', async () => {
  const backend = researchBackend();
  const work = qualifyWorkspaceInteraction(backend.ports, {
    agentId: 'alpha',
    interactionId: 'qualification-request',
    message: 'qualification',
  });
  await until(() => backend.runs.size === 1);
  await backend.finish([...backend.runs.keys()][0]!);
  expect((await work).status).toBe('completed');
});
