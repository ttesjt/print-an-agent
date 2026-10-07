import type { AgentDetails, AgentSummary } from '@ta-agent/ui-contracts';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AgentCatalog,
  AgentConfigForm,
  AgentCreateDialog,
  AgentDetailsView,
  AgentLifecycleActions,
  ConfigSection,
  DisableAgentDialog,
} from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

const SUMMARY: AgentSummary = Object.freeze({
  agentId: 'research-assistant',
  displayName: 'Research Assistant',
  identityRevision: 'identity-revision-3',
  status: 'active',
  updatedAt: '2026-01-03T00:00:00.000Z',
});

const DETAILS: AgentDetails = Object.freeze({
  ...SUMMARY,
  createdAt: '2026-01-01T00:00:00.000Z',
});

beforeAll(enableReactActEnvironment);
afterEach(() => {
  cleanupReactRoots();
  document.documentElement.style.removeProperty('overflow');
});
afterAll(disableReactActEnvironment);

describe('Agent management components', () => {
  it('presents catalog states and keeps selection authority with the caller', () => {
    const onSelectAgent = vi.fn();
    const container = renderInDocument(
      <AgentCatalog
        emptyTitle="No Agents"
        loadingLabel="Loading Agents"
        onSelectAgent={onSelectAgent}
        selectedAgentId={SUMMARY.agentId}
        state={{ status: 'ready', agents: [SUMMARY] }}
        statusLabels={{ active: 'Available', disabled: 'Unavailable' }}
        workingAgentIds={[SUMMARY.agentId]}
        workingLabel="Updating"
      />
    );

    const button = container.querySelector<HTMLButtonElement>(
      '[data-slot="agent-list-item"] button'
    );
    expect(button?.getAttribute('aria-current')).toBe('true');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('Research Assistant');
    expect(container.textContent).toContain('Updating');

    act(() => button?.click());
    expect(onSelectAgent).toHaveBeenCalledWith(SUMMARY.agentId);
  });

  it('renders safe Agent details and application-defined content', () => {
    const container = renderInDocument(
      <AgentDetailsView
        agent={DETAILS}
        formatTimestamp={(timestamp) => `Formatted ${timestamp}`}
        labels={{
          agentId: 'Agent ID',
          createdAt: 'Created',
          identityRevision: 'Identity revision',
          status: 'Status',
          updatedAt: 'Updated',
        }}
        statusLabels={{ active: 'Available', disabled: 'Unavailable' }}
      >
        <p>Application metadata</p>
      </AgentDetailsView>
    );

    expect(container.querySelectorAll('[data-slot="data-list-item"]')).toHaveLength(5);
    expect(container.textContent).toContain('identity-revision-3');
    expect(container.textContent).toContain('Available');
    expect(container.textContent).toContain('Formatted 2026-01-01T00:00:00.000Z');
    expect(container.textContent).toContain('Application metadata');
  });

  it('keeps create identity and submit authority controlled by the application', () => {
    const onIdentityChange = vi.fn();
    const onSubmit = vi.fn();
    renderInDocument(
      <AgentCreateDialog
        cancelLabel="Cancel"
        configFields={<ConfigSection title="Config">Application fields</ConfigSection>}
        description="Create an Agent"
        fieldErrors={{ agentId: 'This Agent ID is reserved.' }}
        identity={{ agentId: 'new-agent', displayName: 'New Agent' }}
        labels={{ agentId: 'Agent ID', displayName: 'Display name' }}
        onIdentityChange={onIdentityChange}
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
        open
        submitLabel="Create"
        title="Create Agent"
      />
    );

    const dialog = document.querySelector<HTMLDialogElement>('[data-slot="dialog"]');
    const form = dialog?.querySelector<HTMLFormElement>('form');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelectorAll('input')).toHaveLength(2);
    expect(dialog?.textContent).toContain('Application fields');
    expect(dialog?.textContent).toContain('This Agent ID is reserved.');

    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onIdentityChange).not.toHaveBeenCalled();
  });

  it('presents dirty, pending, invalid, and revision-conflict configuration states', () => {
    const onReset = vi.fn();
    const onSubmit = vi.fn();
    const container = renderInDocument(
      <AgentConfigForm
        cancelLabel="Discard"
        conflict="Configuration changed after it was loaded."
        conflictActions={<button type="button">Reload</button>}
        dirty
        onReset={onReset}
        onSubmit={onSubmit}
        saveLabel="Save"
      >
        <ConfigSection title="Interaction">Fields</ConfigSection>
      </AgentConfigForm>
    );

    const form = container.querySelector<HTMLFormElement>('[data-slot="agent-config-form"]');
    expect(form?.getAttribute('data-dirty')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Configuration changed'
    );

    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Discard')
        ?.click();
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('exposes lifecycle actions only when the capability callback is installed', () => {
    const onRequestDisable = vi.fn();
    const onReactivate = vi.fn();
    const container = renderInDocument(
      <div>
        <AgentLifecycleActions
          disableLabel="Disable"
          onRequestDisable={onRequestDisable}
          reactivateLabel="Reactivate"
          status="active"
        />
        <AgentLifecycleActions
          disableLabel="Disable"
          onReactivate={onReactivate}
          reactivateLabel="Reactivate"
          status="disabled"
        />
        <AgentLifecycleActions
          disableLabel="Disable"
          reactivateLabel="Reactivate"
          status="active"
        />
      </div>
    );

    expect(container.querySelectorAll('button')).toHaveLength(2);
    act(() => container.querySelectorAll<HTMLButtonElement>('button')[0]?.click());
    act(() => container.querySelectorAll<HTMLButtonElement>('button')[1]?.click());
    expect(onRequestDisable).toHaveBeenCalledOnce();
    expect(onReactivate).toHaveBeenCalledOnce();
  });

  it('uses an explicit controlled confirmation for disabling an Agent', () => {
    const onConfirm = vi.fn();
    renderInDocument(
      <DisableAgentDialog
        cancelLabel="Cancel"
        confirmLabel="Disable"
        description="Disable this Agent?"
        onConfirm={onConfirm}
        onOpenChange={() => undefined}
        open
        title="Disable Agent"
      />
    );

    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Disable'
    );
    act(() => confirm?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
