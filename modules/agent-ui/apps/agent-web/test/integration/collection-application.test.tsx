import type { CollectionAccessPort, CollectionChoice } from '@print-an-agent/ui-contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import {
  CollectionApplication,
  type CollectionConnection,
} from '../../src/collection/collection-application.js';
import { collectionHash, readCollectionLocation } from '@print-an-agent/ui-workspace';
import { createBrowserComposition } from '../../src/application/browser-composition.js';
import { domEnvironment } from '../support/dom-environment.js';

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const roots: Root[] = [];
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});
afterEach(async () => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  await act(() => domEnvironment().waitUntilComplete());
});
const choices: readonly CollectionChoice<string>[] = [
  { key: 'one', label: 'First collection', reference: 'one' },
  { key: 'two', label: 'Second collection', reference: 'two' },
];
function mount(
  access: CollectionAccessPort<CollectionConnection, string>,
  initialCollection?: CollectionChoice<string>,
  resolveReference?: (key: string, signal: AbortSignal) => Promise<string | undefined>
) {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  act(() =>
    root.render(
      <CollectionApplication
        access={access}
        reference="one"
        choices={choices}
        fields={<p>Application locator field</p>}
        {...(initialCollection === undefined ? {} : { initialCollection })}
        {...(resolveReference === undefined ? {} : { resolveReference })}
      />
    )
  );
  return root;
}
function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label
  );
  if (button === undefined) throw new Error(`Missing ${label}`);
  act(() => button.click());
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    if (check()) return;
  }
  throw new Error(document.body.textContent ?? 'Not settled');
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {
    throw new Error('Deferred promise is not initialized');
  };
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function fixtureAccess() {
  const connections = new Map(
    choices.map((choice) => [
      choice.reference,
      {
        ports: createBrowserComposition('http://localhost/?mode=deterministic').ports,
        profileLabel: choice.label,
      },
    ])
  );
  const openCollection: CollectionAccessPort<CollectionConnection, string>['openCollection'] = (
    input
  ) => {
    const collection = choices.find((choice) => choice.reference === input.reference);
    const connection = connections.get(input.reference);
    if (collection === undefined || connection === undefined)
      return Promise.resolve({ ok: false, message: 'Missing fixture' });
    return Promise.resolve({ ok: true, collection, connection });
  };
  return { openCollection };
}
async function openFirst() {
  click('First collection');
  await until(
    () => document.querySelector('[data-slot="conversation-composer"][data-state="idle"]') !== null
  );
}
function editComposer(value: string) {
  const control = document.querySelector<HTMLTextAreaElement>(
    '[data-slot="conversation-composer"] textarea'
  );
  if (control === null) throw new Error('Composer missing');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      control,
      value
    );
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function navigateHash(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

it('routes without serializing references, isolates identical Agent identities and revalidates each opening', async () => {
  const connections = new Map<string, CollectionConnection>();
  for (const choice of choices) {
    const composition = createBrowserComposition('http://localhost/?mode=deterministic');
    const snapshot = await composition.ports.agents.inspectAgent({ agentId: 'research-assistant' });
    if (snapshot.status !== 'succeeded') throw new Error('Fixture missing');
    const renamed = await composition.ports.agents.renameAgent({
      agentId: 'research-assistant',
      displayName: `Agent in ${choice.key}`,
      expectedRevision: snapshot.value.details.identityRevision,
    });
    expect(renamed.status).toBe('succeeded');
    connections.set(choice.key, { ports: composition.ports, profileLabel: choice.label });
  }
  const openCollection = vi.fn<
    CollectionAccessPort<CollectionConnection, string>['openCollection']
  >(async ({ reference }) => {
    await Promise.resolve();
    const choice = choices.find((item) => item.reference === reference);
    const connection = connections.get(reference);
    if (choice === undefined || connection === undefined)
      return { ok: false, message: 'Unknown collection' };
    return { ok: true, collection: choice, connection };
  });
  mount({ openCollection });
  expect(document.querySelector('[data-slot="collection-list"]')).not.toBeNull();
  click('First collection');
  await until(() => document.body.textContent?.includes('Agent in one') === true);
  expect(readCollectionLocation(window.location.hash)).toMatchObject({
    route: 'workspace',
    collectionKey: 'one',
  });
  click('Collections');
  click('Second collection');
  await until(() => document.body.textContent?.includes('Agent in two') === true);
  expect(document.body.textContent).not.toContain('Agent in one');
  click('Collections');
  click('First collection');
  await until(() => document.body.textContent?.includes('Agent in one') === true);
  expect(openCollection.mock.calls.map(([input]) => input.reference)).toEqual([
    'one',
    'two',
    'one',
  ]);
});

it('does not publish or mount a late opening after application unmount', async () => {
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const composition = createBrowserComposition('http://localhost/?mode=deterministic');
  const root = mount({
    openCollection: async (input) => {
      signal = input.signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        ok: true,
        collection: choices[0]!,
        connection: { ports: composition.ports, profileLabel: 'late' },
      };
    },
  });
  click('First collection');
  act(() => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    release?.();
    await Promise.resolve();
  });
  expect(window.location.hash).toBe('#collections');
  expect(document.querySelector('[data-slot="app-shell"]')).toBeNull();
});

it('rejects malformed routes and keeps locator data out of the URL', () => {
  const hash = collectionHash('canonical-key', { agentId: 'same-id', sessionId: 'same-session' });
  expect(readCollectionLocation(hash)).toEqual({
    route: 'workspace',
    collectionKey: 'canonical-key',
    workspace: { agentId: 'same-id', sessionId: 'same-session' },
  });
  expect(() => readCollectionLocation('#collection=a&collection=b')).toThrow();
  expect(() => readCollectionLocation('#collection=a&root=/private')).toThrow();
});

it('honours confirmed draft discard when navigating directly into another Collection', async () => {
  mount(fixtureAccess(), undefined, () => Promise.resolve('two'));
  await openFirst();
  editComposer('Approved for discard');
  navigateHash(collectionHash('two'));
  expect(document.querySelector('dialog[open]')?.textContent).toContain('Leave this Collection?');
  click('Discard and leave');
  await until(
    () =>
      readCollectionLocation(window.location.hash).route === 'workspace' &&
      window.location.hash.includes('collection=two')
  );
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  expect(document.body.textContent).not.toContain('resolve unsaved changes');
});

it('does not extend discard authority to new edits made while an approved switch is opening', async () => {
  const access = fixtureAccess();
  const gate = deferred<void>();
  let opening = false;
  mount(
    {
      openCollection: async (input) => {
        if (input.reference === 'two') {
          opening = true;
          await gate.promise;
        }
        return access.openCollection(input);
      },
    },
    undefined,
    () => Promise.resolve('two')
  );
  await openFirst();
  const originalHash = window.location.hash;
  editComposer('First draft');
  navigateHash(collectionHash('two'));
  click('Discard and leave');
  await until(() => opening);
  editComposer('New draft while opening');
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  await until(() => document.body.textContent?.includes('resolve unsaved changes') === true);
  expect(window.location.hash).toBe(originalHash);
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
    'New draft while opening'
  );
});

it.each([
  ['resolver', 'popstate'],
  ['resolver', 'hashchange'],
  ['opening', 'popstate'],
  ['opening', 'hashchange'],
] as const)(
  'supersedes delayed %s when navigating back to the bound Collection via %s',
  async (phase, eventType) => {
    const access = fixtureAccess();
    const gate = deferred<void>();
    let signal: AbortSignal | undefined;
    mount(
      {
        openCollection: async (input) => {
          if (input.reference === 'two' && phase === 'opening') {
            signal = input.signal;
            await gate.promise; // Intentionally ignore cancellation to test late-result suppression.
          }
          return access.openCollection(input);
        },
      },
      undefined,
      async (_key, resolverSignal) => {
        if (phase === 'resolver') {
          signal = resolverSignal;
          await gate.promise;
        }
        return 'two';
      }
    );
    await openFirst();
    const originalHash = window.location.hash;
    navigateHash(collectionHash('two'));
    await until(() => signal !== undefined);
    editComposer('Keep A');
    act(() => {
      window.history.replaceState(null, '', `/${originalHash}`);
      window.dispatchEvent(
        eventType === 'popstate' ? new PopStateEvent('popstate') : new HashChangeEvent('hashchange')
      );
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(window.location.hash).toBe(originalHash);
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep A');
    expect(document.body.textContent).not.toContain('Opening Collection…');
  }
);

it.each(['unavailable', 'rejected'] as const)(
  'keeps new drafts when delayed reference resolution is %s',
  async (outcome) => {
    const gate = deferred<void>();
    let resolving = false;
    mount(fixtureAccess(), undefined, async () => {
      resolving = true;
      await gate.promise;
      if (outcome === 'rejected') throw new Error('Resolver unavailable');
      return undefined;
    });
    await openFirst();
    const originalHash = window.location.hash;
    navigateHash(collectionHash('two'));
    await until(() => resolving);
    editComposer('Draft created during resolution');
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await until(() => !document.body.textContent?.includes('Opening Collection…'));
    expect(window.location.hash).toBe(originalHash);
    expect(document.querySelector('[data-slot="collection-setup"]')).toBeNull();
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      'Draft created during resolution'
    );
  }
);

it('allows unavailable-reference recovery after explicit discard of the unchanged draft', async () => {
  mount(fixtureAccess(), undefined, () => Promise.resolve(undefined));
  await openFirst();
  editComposer('Approved for discard');
  navigateHash(collectionHash('two'));
  click('Discard and leave');
  await until(() => document.querySelector('[data-slot="collection-setup"]') !== null);
  expect(window.location.hash).toBe('#collections');
  expect(document.body.textContent).toContain('This Collection is not available');
});

it('cancels an older opening on a native hash navigation within the bound Collection', async () => {
  const access = fixtureAccess();
  const gate = deferred<void>();
  let signal: AbortSignal | undefined;
  mount(
    {
      openCollection: async (input) => {
        if (input.reference === 'two') {
          signal = input.signal;
          await gate.promise;
        }
        return access.openCollection(input);
      },
    },
    undefined,
    () => Promise.resolve('two')
  );
  await openFirst();
  navigateHash(collectionHash('two'));
  await until(() => signal !== undefined);
  editComposer('Keep the current Collection draft');
  act(() => {
    // Unlike our published URL, this new same-Collection URL is a genuine hash navigation.
    window.location.hash = collectionHash('one');
  });
  await until(() => signal?.aborted === true);
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  expect(readCollectionLocation(window.location.hash)).toMatchObject({ collectionKey: 'one' });
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
    'Keep the current Collection draft'
  );
});
