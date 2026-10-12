import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type { MutationOutcome, RevisionedValue } from '@ta-agent/ui-contracts';
import { useRevisionedEditor, useWorkspaceBoundary, useWorkspaceMutation } from '../src/index.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function render(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
    await Promise.resolve();
  });
}

it('keeps independent revisions, pending states, notices and newer edits across two editors', async () => {
  const saving = deferred<MutationOutcome<RevisionedValue<string>>>();
  let fields: ReturnType<typeof useRevisionedEditor<string>>[] = [];
  let boundary: ReturnType<typeof useWorkspaceBoundary> | undefined;
  function Product() {
    const one = useRevisionedEditor({
      scope: 'agent/settings',
      equals: Object.is,
      read: () => Promise.resolve({ revision: 'settings-1', value: 'first' }),
      save: () => saving.promise,
    });
    const two = useRevisionedEditor({
      scope: 'agent/provisioning',
      equals: Object.is,
      read: () => Promise.resolve({ revision: 'provisioning-9', value: 'other' }),
      save: () =>
        Promise.resolve({
          status: 'rejected',
          failure: { code: 'unavailable', message: 'Try later' },
        }),
    });
    fields = [one, two];
    boundary = useWorkspaceBoundary([one.boundary, two.boundary]);
    return null;
  }
  await render(<Product />);
  act(() => {
    fields[0]?.setDraft('submitted');
    fields[1]?.setDraft('untouched draft');
  });
  let execution: Promise<void> | undefined;
  act(() => {
    execution = fields[0]?.save();
  });
  expect(fields[0]?.pending).toBe(true);
  expect(fields[1]?.pending).toBe(false);
  const identity = boundary?.editIdentity;
  act(() => fields[0]?.setDraft('newer edit'));
  expect(boundary?.editIdentity).not.toBe(identity);
  await act(async () => {
    saving.resolve({
      status: 'committed',
      value: { revision: 'settings-2', value: 'submitted' },
      notices: [{ code: 'refresh-failed', message: 'Saved; refresh needed' }],
    });
    await execution;
  });
  expect(fields[0]).toMatchObject({
    snapshot: { revision: 'settings-2' },
    draft: 'newer edit',
    dirty: true,
    pending: false,
    result: { status: 'committed' },
  });
  expect(fields[1]).toMatchObject({
    snapshot: { revision: 'provisioning-9' },
    draft: 'untouched draft',
    dirty: true,
  });
  await act(() => fields[1]?.save());
  expect(fields[1]?.result?.status).toBe('rejected');
  expect(fields[0]?.result?.status).toBe('committed');
});

it('requires authoritative reconciliation after unknown outcomes, without retrying automatically', async () => {
  let calls = 0;
  let editor: ReturnType<typeof useRevisionedEditor<string>> | undefined;
  function Product() {
    editor = useRevisionedEditor({
      scope: 'a',
      equals: Object.is,
      read: () => Promise.resolve({ revision: 'r', value: 'saved' }),
      save: () => {
        calls++;
        return Promise.reject(new Error('private backend details'));
      },
    });
    return null;
  }
  await render(<Product />);
  act(() => editor?.setDraft('new'));
  await act(() => editor?.save());
  await act(() => editor?.save());
  expect(calls).toBe(1);
  expect(editor?.result).toMatchObject({ status: 'indeterminate' });
  expect(JSON.stringify(editor?.result)).not.toContain('private');
  await act(() => editor?.reload());
  expect(editor?.result).toBeUndefined();
  expect(editor?.dirty).toBe(false);
});

it('preserves a confirmed creation despite a cancellation request and preparation failure', async () => {
  const outcome = deferred<MutationOutcome<{ agentId: string }>>();
  let mutation: ReturnType<typeof useWorkspaceMutation<void, { agentId: string }>> | undefined;
  let created: string | undefined;
  function Product() {
    mutation = useWorkspaceMutation({
      scope: 'creation',
      execute: () => outcome.promise,
      onCommitted: (value) => {
        created = value.agentId;
      },
    });
    return null;
  }
  await render(<Product />);
  let run: ReturnType<NonNullable<typeof mutation>['run']> | undefined;
  act(() => {
    run = mutation?.run();
    mutation?.cancel();
  });
  await act(async () => {
    outcome.resolve({
      status: 'committed',
      value: { agentId: 'new-agent' },
      notices: [{ code: 'not-ready', message: 'Created; preparation failed' }],
    });
    await run;
  });
  expect(created).toBe('new-agent');
  expect(mutation?.pending).toBe(false);
  expect(mutation?.result?.status).toBe('committed');
});

it('retains edits made during reconciliation and suppresses a mutation from a departed scope', async () => {
  const reading = deferred<RevisionedValue<string>>();
  const saving = deferred<MutationOutcome<RevisionedValue<string>>>();
  let slow = false;
  let editor: ReturnType<typeof useRevisionedEditor<string>> | undefined;
  let commits = 0;
  function Product({ scope }: { scope: string }) {
    editor = useRevisionedEditor({
      scope,
      equals: Object.is,
      read: () => (slow ? reading.promise : Promise.resolve({ revision: scope, value: scope })),
      save: () => saving.promise,
      onCommitted: () => {
        commits++;
      },
    });
    return null;
  }
  await render(<Product scope="a" />);
  slow = true;
  let reload: Promise<void> | undefined;
  act(() => {
    reload = editor?.reload();
  });
  act(() => editor?.setDraft('new edit during reload'));
  await act(async () => {
    reading.resolve({ revision: 'a-new', value: 'server value' });
    await reload;
  });
  expect(editor?.snapshot?.revision).toBe('a-new');
  expect(editor?.draft).toBe('new edit during reload');
  let save: Promise<void> | undefined;
  act(() => {
    save = editor?.save();
  });
  slow = false;
  await act(async () => {
    root?.render(<Product scope="b" />);
    await Promise.resolve();
  });
  await act(async () => {
    saving.resolve({
      status: 'committed',
      value: { revision: 'a-later', value: 'old result' },
      notices: [],
    });
    await save;
  });
  expect(editor?.snapshot?.revision).toBe('b');
  expect(editor?.draft).toBe('b');
  expect(commits).toBe(0);
});
