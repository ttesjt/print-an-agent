import type {
  SessionDetails,
  SessionNavigationSnapshot,
  SessionSummary,
} from '@ta-agent/ui-contracts';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  PurgeSessionDialog,
  RenameSessionDialog,
  SessionCatalog,
  SessionDetailsView,
  SessionLifecycleActions,
  SessionNavigationView,
} from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

const SUMMARY: SessionSummary = Object.freeze({
  agentId: 'research-assistant',
  branchCount: 2,
  createdAt: '2026-02-01T00:00:00.000Z',
  metadataRevision: 'metadata-2',
  navigationRevision: 'navigation-3',
  selectedBranchId: 'main',
  sessionId: 'session-1',
  status: 'active',
  title: 'Evidence review',
  turnCount: 4,
  updatedAt: '2026-02-02T00:00:00.000Z',
});
const DETAILS: SessionDetails = SUMMARY;
const NAVIGATION: SessionNavigationSnapshot = Object.freeze({
  agentId: SUMMARY.agentId,
  branches: Object.freeze([
    Object.freeze({
      branchId: 'main',
      createdAt: '2026-02-01T00:00:00.000Z',
      headTurnId: 'turn-2',
    }),
    Object.freeze({
      branchId: 'alternative',
      createdAt: '2026-02-01T01:00:00.000Z',
      forkedFromTurnId: 'turn-1',
      parentBranchId: 'main',
    }),
  ]),
  revision: 'navigation-3',
  selectedBranchId: 'main',
  sessionId: SUMMARY.sessionId,
});

beforeAll(enableReactActEnvironment);
afterEach(() => {
  cleanupReactRoots();
  document.documentElement.style.removeProperty('overflow');
});
afterAll(disableReactActEnvironment);

describe('Session management components', () => {
  it('presents selection, localized status, metadata, and explicit load-more authority', () => {
    const onSelectSession = vi.fn();
    const onLoadMore = vi.fn();
    const container = renderInDocument(
      <SessionCatalog
        emptyTitle="No Sessions"
        formatMetadata={(session) => `${String(session.turnCount)} turns`}
        loadMoreLabel="Load more"
        loadingLabel="Loading Sessions"
        onLoadMore={onLoadMore}
        onSelectSession={onSelectSession}
        selectedSessionId={SUMMARY.sessionId}
        state={{ hasMore: true, sessions: [SUMMARY], status: 'ready' }}
        statusLabels={{ active: 'Current', retired: 'Archived' }}
        untitledLabel="Untitled Session"
        workingLabel="Updating"
      />
    );

    const sessionButton = container.querySelector<HTMLButtonElement>(
      '[data-slot="session-list-item"] button'
    );
    expect(sessionButton?.getAttribute('aria-current')).toBe('true');
    expect(container.textContent).toContain('Current');
    expect(container.textContent).toContain('4 turns');
    act(() => sessionButton?.click());
    act(() =>
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Load more')
        ?.click()
    );
    expect(onSelectSession).toHaveBeenCalledWith(SUMMARY.sessionId);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('delegates timestamp and status presentation for Session details', () => {
    const container = renderInDocument(
      <SessionDetailsView
        formatTimestamp={(timestamp) => `Formatted ${timestamp}`}
        labels={{
          branches: 'Branches',
          createdAt: 'Created',
          sessionId: 'Session ID',
          status: 'Status',
          turns: 'Turns',
          updatedAt: 'Updated',
        }}
        session={DETAILS}
        statusLabels={{ active: 'Current', retired: 'Archived' }}
        title="Evidence review"
      />
    );

    expect(container.textContent).toContain('Current');
    expect(container.textContent).toContain('Formatted 2026-02-01T00:00:00.000Z');
    expect(container.querySelectorAll('[data-slot="data-list-item"]')).toHaveLength(6);
  });

  it('keeps working presentation independent from application-owned selection disabling', () => {
    const onSelectSession = vi.fn();
    const container = renderInDocument(
      <SessionCatalog
        emptyTitle="No Sessions"
        disabledSessionIds={[SUMMARY.sessionId]}
        formatMetadata={() => 'Metadata'}
        loadMoreLabel="Load more"
        loadingLabel="Loading Sessions"
        onSelectSession={onSelectSession}
        state={{ hasMore: false, sessions: [SUMMARY], status: 'ready' }}
        statusLabels={{ active: 'Current', retired: 'Archived' }}
        untitledLabel="Untitled Session"
        workingLabel="Updating"
        workingSessionIds={[SUMMARY.sessionId]}
      />
    );

    const button = container.querySelector<HTMLButtonElement>(
      '[data-slot="session-list-item"] button'
    );
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    act(() => button?.click());
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('keeps rename values, validation, and submit authority controlled', () => {
    const onSubmit = vi.fn();
    const onTitleChange = vi.fn();
    renderInDocument(
      <RenameSessionDialog
        cancelLabel="Cancel"
        description="Rename this Session"
        fieldError="Title is required."
        label="Title"
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
        onTitleChange={onTitleChange}
        open
        submitLabel="Rename"
        title="Rename Session"
        value="Evidence review"
      />
    );

    const dialog = document.querySelector<HTMLDialogElement>('dialog');
    expect(dialog?.textContent).toContain('Title is required.');
    act(() => {
      dialog?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('exposes lifecycle and purge only when corresponding capabilities are installed', () => {
    const onRetire = vi.fn();
    const onRestore = vi.fn();
    const onPurge = vi.fn();
    const container = renderInDocument(
      <div>
        <SessionLifecycleActions
          onRequestRetire={onRetire}
          purgeLabel="Purge"
          restoreLabel="Restore"
          retireLabel="Retire"
          status="active"
        />
        <SessionLifecycleActions
          onRequestPurge={onPurge}
          onRestore={onRestore}
          purgeLabel="Purge"
          restoreLabel="Restore"
          retireLabel="Retire"
          status="retired"
        />
        <SessionLifecycleActions
          purgeLabel="Purge"
          restoreLabel="Restore"
          retireLabel="Retire"
          status="retired"
        />
      </div>
    );
    expect(container.querySelectorAll('button')).toHaveLength(3);
  });

  it('presents branch lineage while leaving branch selection with the application', () => {
    const onSelectBranch = vi.fn();
    const container = renderInDocument(
      <SessionNavigationView
        formatBranchDescription={(branch) => branch.parentBranchId ?? 'Root branch'}
        getBranchLabel={(branch) => branch.branchId}
        navigation={NAVIGATION}
        onSelectBranch={onSelectBranch}
        selectedLabel="Selected"
        title="Branches"
        workingLabel="Selecting"
      />
    );
    const branches = container.querySelectorAll('[data-slot="session-branch-item"]');
    expect(branches).toHaveLength(2);
    expect(branches[0]?.getAttribute('data-selected')).toBe('true');
    expect(branches[0]?.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    act(() => branches[1]?.querySelector('button')?.click());
    expect(onSelectBranch).toHaveBeenCalledWith('alternative');
  });

  it('makes branch selection single-flight while any branch is pending', () => {
    const container = renderInDocument(
      <SessionNavigationView
        formatBranchDescription={(branch) => branch.parentBranchId ?? 'Root branch'}
        getBranchLabel={(branch) => branch.branchId}
        navigation={NAVIGATION}
        onSelectBranch={() => undefined}
        selectedLabel="Selected"
        title="Branches"
        workingBranchId="alternative"
        workingLabel="Selecting"
      />
    );

    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          '[data-slot="session-branch-item"] button'
        ),
      ].map((button) => button.disabled)
    ).toEqual([true, true]);
  });

  it('uses explicit controlled confirmation for permanent purge', () => {
    const onConfirm = vi.fn();
    renderInDocument(
      <PurgeSessionDialog
        cancelLabel="Cancel"
        confirmLabel="Permanently delete"
        description="This cannot be undone."
        onConfirm={onConfirm}
        onOpenChange={() => undefined}
        open
        title="Delete Session"
      />
    );
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Permanently delete'
    );
    act(() => confirm?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
