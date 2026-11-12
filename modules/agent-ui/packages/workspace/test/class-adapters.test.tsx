import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ForkSessionBranchInput,
  RenameSessionInput,
  RewindSessionBranchInput,
  SelectSessionBranchInput,
  SessionDetails,
  SessionNavigationSnapshot,
  WorkspaceConversationPort,
  WorkspaceSessionPort,
} from '@print-an-agent/ui-contracts';
import { useConversationManagement, useSessionManagement } from '../src/testing.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});

const timestamp = '2026-01-01T00:00:00Z';
function succeeded<Value>(value: Value) {
  return Promise.resolve({ status: 'succeeded' as const, value });
}

/** Prototype methods intentionally depend on instance state; arrow adapters miss receiver bugs. */
class SessionAdapter implements WorkspaceSessionPort, WorkspaceConversationPort {
  readonly calls: string[] = [];
  details: SessionDetails = {
    agentId: 'a',
    sessionId: 's',
    title: 'Before',
    status: 'active',
    metadataRevision: '1',
    navigationRevision: '1',
    selectedBranchId: 'main',
    branchCount: 2,
    turnCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  navigation: SessionNavigationSnapshot = {
    agentId: 'a',
    sessionId: 's',
    revision: '1',
    selectedBranchId: 'main',
    branches: [
      { branchId: 'main', createdAt: timestamp },
      { branchId: 'other', createdAt: timestamp },
    ],
  };
  listSessions() {
    return succeeded({ records: [this.details] });
  }
  inspectSession() {
    return succeeded(this.details);
  }
  inspectSessionNavigation() {
    return succeeded(this.navigation);
  }
  renameSession(input: RenameSessionInput) {
    this.calls.push('rename');
    this.details = { ...this.details, title: input.title, metadataRevision: '2' };
    return succeeded(this.details);
  }
  retireSession() {
    this.calls.push('retire');
    this.details = {
      ...this.details,
      status: 'retired',
      retiredAt: timestamp,
      metadataRevision: '2',
    };
    return succeeded(this.details);
  }
  restoreSession() {
    this.calls.push('restore');
    this.details = { ...this.details, status: 'active', metadataRevision: '2' };
    return succeeded(this.details);
  }
  purgeSession() {
    this.calls.push('purge');
    return succeeded(undefined);
  }
  selectSessionBranch(input: SelectSessionBranchInput) {
    this.calls.push('select');
    this.navigation = { ...this.navigation, selectedBranchId: input.branchId, revision: '2' };
    return succeeded(this.navigation);
  }
  readConversation() {
    this.calls.push('history');
    return succeeded({ turns: [] });
  }
  streamInteraction(): Promise<void> {
    throw new Error('Not used by branch mutation tests.');
  }
  forkSessionBranch(input: ForkSessionBranchInput) {
    this.calls.push(`fork:${input.throughTurnId}`);
    return succeeded({ affectedBranchId: 'other', navigation: this.navigation });
  }
  rewindSessionBranch(input: RewindSessionBranchInput) {
    this.calls.push(`rewind:${input.throughTurnId}`);
    return succeeded({ affectedBranchId: 'main', navigation: this.navigation });
  }
}

async function mount<Value>(useController: () => Value) {
  let controller: Value | undefined;
  function Probe() {
    controller = useController();
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe />);
    await Promise.resolve();
  });
  return () => {
    if (controller === undefined) throw new Error('Controller not mounted.');
    return controller;
  };
}

async function mountSession(adapter: SessionAdapter) {
  const read = await mount(() => useSessionManagement('a', adapter));
  await act(async () => {
    read().selectSession('s');
    await Promise.resolve();
  });
  expect(read().selectionState.status).toBe('ready');
  return read;
}

it('renames through a class adapter while preserving its receiver and updating the workspace', async () => {
  const adapter = new SessionAdapter();
  const read = await mountSession(adapter);
  act(() => read().setRenameTitle('After'));
  await act(() => read().renameSession());
  expect(adapter.calls).toContain('rename');
  expect(read().selectionState).toMatchObject({
    details: { title: 'After', metadataRevision: '2' },
  });
  expect(read().renameError).toBeUndefined();
});

it.each(['retire', 'restore', 'purge'] as const)(
  'preserves the class receiver for Session %s',
  async (operation) => {
    const adapter = new SessionAdapter();
    if (operation !== 'retire')
      adapter.details = { ...adapter.details, status: 'retired', retiredAt: timestamp };
    const read = await mountSession(adapter);
    await act(() =>
      operation === 'purge'
        ? read().purgeSession()
        : read().changeLifecycle(operation === 'retire' ? 'retired' : 'active')
    );
    expect(adapter.calls).toContain(operation);
    expect(read().lifecycleError).toBeUndefined();
    expect(read().selectedSessionId).toBeUndefined();
  }
);

it('selects a branch through a class adapter and updates the navigation revision', async () => {
  const adapter = new SessionAdapter();
  const read = await mountSession(adapter);
  await act(() => read().selectBranch('other'));
  expect(adapter.calls).toContain('select');
  expect(read().selectionState).toMatchObject({
    navigation: { selectedBranchId: 'other', revision: '2' },
  });
  expect(read().navigationError).toBeUndefined();
});

it.each(['fork', 'rewind'] as const)(
  'preserves the class receiver for %s and reconciles navigation',
  async (operation) => {
    const adapter = new SessionAdapter();
    const changed = vi.fn();
    const sessionState = {
      status: 'ready',
      details: adapter.details,
      navigation: adapter.navigation,
    } as const;
    const read = await mount(() =>
      useConversationManagement({
        agentId: 'a',
        management: adapter,
        sessionState,
        onConversationCommitted: () => {},
        onInteractionSettled: () => {},
        onNavigationChanged: changed,
      })
    );
    await act(() =>
      operation === 'fork' ? read().forkFromTurn('turn') : read().rewindToTurn('turn')
    );
    expect(adapter.calls).toContain(`${operation}:turn`);
    expect(read().branchMutationError).toBeUndefined();
    expect(changed).toHaveBeenCalledWith({ agentId: 'a', sessionId: 's' });
  }
);
