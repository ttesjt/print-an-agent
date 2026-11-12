import type {
  RecentCollection,
  RecentCollectionsPersistencePort,
} from '@print-an-agent/ui-contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { useRecentCollections } from '@print-an-agent/ui-workspace';

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const roots: Root[] = [];
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});
function Harness({ port }: { readonly port: RecentCollectionsPersistencePort<string> }) {
  const history = useRecentCollections(port);
  return (
    <div>
      <p data-records>{history.records.map((item) => item.collection.label).join(',')}</p>
      <p data-warning>{history.warning}</p>
      <button
        onClick={() => {
          for (let index = 0; index < 15; index++)
            history.remember({
              key: `key-${index}`,
              label: `Collection ${index}`,
              reference: `locator-${index}`,
            });
        }}
      >
        Fill history
      </button>
      <button
        onClick={() =>
          history.remember({ key: 'key-14', label: 'Canonical alias', reference: 'alias-locator' })
        }
      >
        Remember alias
      </button>
      <button onClick={() => history.forget('key-14')}>Forget</button>
      <button
        onClick={() => history.remember({ key: 'new', label: 'New collection', reference: 'new' })}
      >
        Remember new
      </button>
      <button onClick={() => history.forget('old')}>Forget old</button>
      <button
        onClick={() => history.remember({ key: 'last', label: 'After clear', reference: 'last' })}
      >
        Remember last
      </button>
      <button onClick={history.clear}>Clear</button>
    </div>
  );
}
function mount(port: RecentCollectionsPersistencePort<string>) {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  act(() => root.render(<Harness port={port} />));
  return root;
}
function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === label
  );
  act(() => button?.click());
}
async function settle() {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
  });
}
it('supports non-browser persistence, bounded MRU deduplication and ordered forget/clear', async () => {
  let records: readonly RecentCollection<string>[] = [];
  const port: RecentCollectionsPersistencePort<string> = {
    loadRecentCollections: () => Promise.resolve(records),
    saveRecentCollections: (next) => {
      records = next;
      return Promise.resolve();
    },
  };
  mount(port);
  await settle();
  click('Fill history');
  await settle();
  expect(records).toHaveLength(12);
  expect(records[0]?.collection.key).toBe('key-14');
  click('Remember alias');
  await settle();
  expect(records).toHaveLength(12);
  expect(records[0]?.collection.label).toBe('Canonical alias');
  click('Forget');
  click('Clear');
  await settle();
  expect(records).toEqual([]);
  expect(document.querySelector('[data-records]')?.textContent).toBe('');
});
it('degrades storage failures to a warning while retaining usable history in the current tab', async () => {
  mount({
    loadRecentCollections: () => Promise.reject(new Error('blocked')),
    saveRecentCollections: () => Promise.reject(new Error('quota')),
  });
  await settle();
  expect(document.querySelector('[data-warning]')?.textContent).toContain('unavailable');
  click('Fill history');
  await settle();
  expect(document.querySelector('[data-records]')?.textContent).toContain('Collection 14');
  expect(document.querySelector('[data-warning]')?.textContent).toContain('could not be saved');
});

function record(key: string): RecentCollection<string> {
  return {
    collection: { key, label: key, reference: key },
    lastUsedAt: '2026-10-10T00:00:00.000Z',
  };
}
function delayedHistory() {
  let complete: (records: readonly RecentCollection<string>[]) => void = () => {
    throw new Error('Load not started');
  };
  const pending = new Promise<readonly RecentCollection<string>[]>((resolve) => {
    complete = resolve;
  });
  let records: readonly RecentCollection<string>[] = [record('old'), record('retained')];
  const saves: (readonly RecentCollection<string>[])[] = [];
  let initial = true;
  const port: RecentCollectionsPersistencePort<string> = {
    loadRecentCollections: () => {
      if (!initial) return Promise.resolve(records);
      initial = false;
      return pending;
    },
    saveRecentCollections: (next) => {
      records = next;
      saves.push(next);
      return Promise.resolve();
    },
  };
  return {
    port,
    saves,
    records: () => records,
    complete: () => complete([record('old'), record('retained')]),
  };
}

it('merges remembers into a slow initial load instead of overwriting unseen history', async () => {
  const history = delayedHistory();
  mount(history.port);
  await settle();
  click('Remember new');
  expect(document.querySelector('[data-records]')?.textContent).toBe('New collection');
  expect(history.saves).toEqual([]);
  history.complete();
  await settle();
  expect(history.records().map((entry) => entry.collection.key)).toEqual([
    'new',
    'old',
    'retained',
  ]);
  expect(document.querySelector('[data-records]')?.textContent).toBe('New collection,old,retained');
});

it.each(['forget', 'clear'] as const)(
  'keeps %s ordered relative to remembers during a slow initial load',
  async (operation) => {
    const history = delayedHistory();
    mount(history.port);
    await settle();
    click('Remember new');
    click(operation === 'forget' ? 'Forget old' : 'Clear');
    click('Remember last');
    expect(history.saves).toEqual([]);
    history.complete();
    await settle();
    const expected = operation === 'forget' ? ['last', 'new', 'retained'] : ['last'];
    expect(history.records().map((entry) => entry.collection.key)).toEqual(expected);
    expect(history.saves).toHaveLength(3);
    expect(history.saves[1]?.some((entry) => entry.collection.key === 'old')).toBe(false);
    expect(document.querySelector('[data-records]')?.textContent).not.toContain('old');
  }
);

it("does not publish a previous persistence owner's late load into a replacement owner", async () => {
  const previous = delayedHistory();
  const root = mount(previous.port);
  await settle();
  click('Remember new');
  const port: RecentCollectionsPersistencePort<string> = {
    loadRecentCollections: () => Promise.resolve([record('replacement')]),
    saveRecentCollections: () => Promise.resolve(),
  };
  act(() => root.render(<Harness port={port} />));
  await settle();
  previous.complete();
  await settle();
  expect(document.querySelector('[data-records]')?.textContent).toBe('replacement');
  expect(previous.records().map((entry) => entry.collection.key)).toEqual([
    'new',
    'old',
    'retained',
  ]);
});

it('retains in-tab history after failed saves and resumes reloads after a successful save', async () => {
  let stored: readonly RecentCollection<string>[] = [record('old')];
  let unavailable = true;
  let notify = () => {};
  let reads = 0;
  const port: RecentCollectionsPersistencePort<string> = {
    loadRecentCollections: () => {
      reads++;
      return Promise.resolve(stored);
    },
    saveRecentCollections: (records) => {
      if (unavailable) return Promise.reject(new Error('quota'));
      stored = records;
      return Promise.resolve();
    },
    subscribe: (listener) => {
      notify = listener;
      return () => {
        notify = () => {};
      };
    },
  };
  mount(port);
  await settle();
  click('Remember new');
  await settle();
  act(() => notify());
  await settle();
  expect(reads).toBe(1);
  expect(document.querySelector('[data-records]')?.textContent).toBe('New collection,old');
  expect(document.querySelector('[data-warning]')?.textContent).toContain('could not be saved');
  unavailable = false;
  click('Remember last');
  await settle();
  act(() => notify());
  await settle();
  expect(reads).toBe(2);
  expect(document.querySelector('[data-records]')?.textContent).toBe(
    'After clear,New collection,old'
  );
  expect(document.querySelector('[data-warning]')?.textContent).toBe('');
});
