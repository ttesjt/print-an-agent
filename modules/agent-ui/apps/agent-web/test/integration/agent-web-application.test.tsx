import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createDeterministicAgentManagement,
  type DeterministicAgentManagement,
} from '../../src/adapters/deterministic-agent-management.js';
import {
  createDeterministicConversationManagement,
  type DeterministicConversationManagement,
} from '../../src/adapters/deterministic-conversation-management.js';
import {
  createDeterministicSessionManagement,
  type DeterministicSessionManagement,
} from '../../src/adapters/deterministic-session-management.js';
import { App } from '../../src/app.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';
import { domEnvironment } from '../support/dom-environment.js';

const mountedRoots = new Set<Root>();
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  domEnvironment().setWindowSize({ width: 1280, height: 900 });
});

afterEach(() => {
  for (const root of mountedRoots) act(() => root.unmount());
  mountedRoots.clear();
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('overflow');
});

afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

describe('Agent Web deterministic composition', () => {
  it('renders its complete semantic shell before client effects run', () => {
    const sessionManagement = createDeterministicSessionManagement();
    const markup = renderToStaticMarkup(
      <App
        ports={{
          agents: createDeterministicAgentManagement(),
          conversations: createDeterministicConversationManagement(sessionManagement),
          sessions: sessionManagement,
        }}
      />
    );

    expect(markup).toContain('class="ta-ui-app-shell ta-ui-root ta-ui-workspace-shell"');
    expect(markup).toContain('class="ta-ui-app-shell__header"');
    expect(markup).toContain('class="ta-ui-app-shell__sidebar"');
    expect(markup).toContain('class="ta-ui-app-shell__main"');
    expect(markup).not.toContain('class="ta-ui-app-shell__inspector"');
    expect(markup).toContain('Loading Agents…');
    expect(markup).not.toContain('style=');
  });

  it('loads catalog and inspection through the application-owned adapter', async () => {
    const view = renderApp();
    expect(view.container.textContent).toContain('Loading Agents…');

    await flushReact();

    expect(view.container.querySelector('[data-slot="agent-list"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Research Assistant');
    expect(view.container.querySelector('[data-slot="agent-details"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Research carefully and cite evidence.');

    const reviewButton = [...view.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('Review Assistant')
    );
    act(() => reviewButton?.click());
    await flushReact();

    expect(view.container.querySelector('[data-slot="agent-details"]')?.textContent).toContain(
      'Review Assistant'
    );
    expect(view.container.textContent).toContain('Reactivate Agent');
  });

  it('navigates deterministic Sessions and keeps a new conversation as an unsaved draft', async () => {
    const view = renderApp();
    await flushReact();

    expect(view.container.querySelector('[data-slot="session-list"]')).not.toBeNull();
    clickButton(view.container, 'Load more Sessions');
    await flushReact();
    expect(view.container.textContent).toContain('Evidence review');
    clickButtonContaining(view.container, 'Evidence review');
    await flushReact();

    clickButton(view.container, 'Session details');

    expect(view.container.querySelector('[data-slot="session-details"]')).not.toBeNull();
    expect(view.container.querySelectorAll('[data-slot="session-branch-item"]')).toHaveLength(2);
    clickButtonContaining(view.container, 'alternative');
    await flushReact();
    expect(
      view.container
        .querySelector('[data-branch-id="alternative"] button')
        ?.getAttribute('aria-current')
    ).toBe('true');

    clickButton(view.container, 'New');
    expect(view.container.querySelector('[data-session-draft]')).not.toBeNull();
    expect(view.container.querySelector('[data-session-draft] h1')?.textContent).toBe(
      'New conversation'
    );
    expect(view.container.querySelector('[data-submitted-conversation]')).toBeNull();
  });

  it('enforces Session pagination, metadata, lifecycle, purge, and branch revisions', async () => {
    const management = createDeterministicSessionManagement();
    const firstPage = await management.listSessions({
      agentId: 'research-assistant',
      status: 'active',
    });
    expect(firstPage.status).toBe('succeeded');
    if (firstPage.status === 'failed') return;
    expect(firstPage.value.records).toHaveLength(2);
    expect(firstPage.value.nextCursor).toBe('cursor-2');

    const inspected = await management.inspectSession({
      agentId: 'research-assistant',
      sessionId: 'research-session-1',
    });
    expect(inspected.status).toBe('succeeded');
    if (inspected.status === 'failed') return;

    const renamed = await management.renameSession({
      agentId: inspected.value.agentId,
      expectedRevision: inspected.value.metadataRevision,
      sessionId: inspected.value.sessionId,
      title: 'Renamed evidence review',
    });
    expect(renamed.status).toBe('succeeded');
    const staleRename = await management.renameSession({
      agentId: inspected.value.agentId,
      expectedRevision: inspected.value.metadataRevision,
      sessionId: inspected.value.sessionId,
      title: 'Stale title',
    });
    expect(staleRename.status).toBe('failed');
    if (staleRename.status === 'failed') {
      expect(staleRename.failure.code).toBe('revision-conflict');
    }

    const navigation = await management.inspectSessionNavigation({
      agentId: inspected.value.agentId,
      sessionId: inspected.value.sessionId,
    });
    expect(navigation.status).toBe('succeeded');
    if (navigation.status === 'failed') return;
    const selected = await management.selectSessionBranch({
      agentId: inspected.value.agentId,
      branchId: 'alternative',
      expectedRevision: navigation.value.revision,
      sessionId: inspected.value.sessionId,
    });
    expect(selected.status).toBe('succeeded');
    if (selected.status === 'succeeded') {
      expect(selected.value.selectedBranchId).toBe('alternative');
    }

    if (renamed.status === 'failed') return;
    const retired = await management.retireSession({
      agentId: renamed.value.agentId,
      expectedRevision: renamed.value.metadataRevision,
      sessionId: renamed.value.sessionId,
    });
    expect(retired.status).toBe('succeeded');
    if (retired.status === 'failed') return;
    expect(
      await management.purgeSession({
        agentId: retired.value.agentId,
        confirmation: 'permanently-delete-session',
        expectedRevision: retired.value.metadataRevision,
        sessionId: retired.value.sessionId,
      })
    ).toEqual({ status: 'succeeded', value: undefined });
  });

  it('does not let a delayed Session inspection replace a newer Agent selection', async () => {
    const base = createDeterministicSessionManagement();
    const pendingInspection = createDeferred<void>();
    const management: DeterministicSessionManagement = Object.freeze({
      ...base,
      inspectSession: async (
        input: Parameters<DeterministicSessionManagement['inspectSession']>[0]
      ) => {
        if (input.sessionId === 'research-session-1') await pendingInspection.promise;
        return base.inspectSession(input);
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), management);
    await flushReact();

    clickButton(view.container, 'Load more Sessions');
    await flushReact();
    clickButtonContaining(view.container, 'Evidence review');
    clickButtonContaining(view.container, 'Review Assistant');
    await flushReact();

    expect(view.container.querySelector('[data-slot="app-shell-header"]')?.textContent).toContain(
      'Review Assistant'
    );
    expect(view.container.textContent).toContain('Change review');

    pendingInspection.resolve();
    await flushReact();
    expect(view.container.querySelector('[data-slot="app-shell-header"]')?.textContent).toContain(
      'Review Assistant'
    );
    expect(view.container.querySelector('[data-slot="session-details"]')).toBeNull();
  });

  it('merges a delayed branch result without reverting concurrent Session metadata', async () => {
    const base = createDeterministicSessionManagement();
    const pendingBranch = createDeferred<void>();
    const management: DeterministicSessionManagement = Object.freeze({
      ...base,
      selectSessionBranch: async (
        input: Parameters<DeterministicSessionManagement['selectSessionBranch']>[0]
      ) => {
        await pendingBranch.promise;
        return base.selectSessionBranch(input);
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), management);
    await selectEvidenceReview(view.container);

    clickButtonContaining(view.container, 'alternative');
    clickButton(view.container, 'Rename');
    const renameDialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    changeValue(renameDialog?.querySelector<HTMLInputElement>('input') ?? null, 'Updated evidence');
    clickButton(document.body, 'Rename Session', 'dialog');
    await flushReact();
    expect(view.container.querySelector('[data-slot="session-details"]')?.textContent).toContain(
      'Updated evidence'
    );

    pendingBranch.resolve();
    await flushReact();
    expect(view.container.querySelector('[data-slot="session-details"]')?.textContent).toContain(
      'Updated evidence'
    );
    expect(
      view.container
        .querySelector('[data-branch-id="alternative"] button')
        ?.getAttribute('aria-current')
    ).toBe('true');
  });

  it('keeps Rename revision conflicts visible until authoritative metadata is reloaded', async () => {
    const management = createDeterministicSessionManagement();
    const view = renderApp(createDeterministicAgentManagement(), management);
    await selectEvidenceReview(view.container);

    const current = await management.inspectSession({
      agentId: 'research-assistant',
      sessionId: 'research-session-1',
    });
    expect(current.status).toBe('succeeded');
    if (current.status === 'failed') return;
    await management.renameSession({
      agentId: current.value.agentId,
      expectedRevision: current.value.metadataRevision,
      sessionId: current.value.sessionId,
      title: 'Authoritative title',
    });

    clickButton(view.container, 'Rename');
    const renameDialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    changeValue(renameDialog?.querySelector<HTMLInputElement>('input') ?? null, 'Stale title');
    clickButton(document.body, 'Rename Session', 'dialog');
    await flushReact();

    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(view.container.textContent).toContain('Session metadata changed after it was loaded.');
    clickButton(view.container, 'Reload Session metadata');
    await flushReact();
    expect(view.container.querySelector('[data-slot="session-details"]')?.textContent).toContain(
      'Authoritative title'
    );
    expect(view.container.querySelector('[data-slot="session-list"]')?.textContent).toContain(
      'Authoritative title'
    );
    expect(view.container.textContent).not.toContain(
      'Session metadata changed after it was loaded.'
    );
  });

  it('retries a failed Session inspection and reconciles the catalog', async () => {
    const base = createDeterministicSessionManagement();
    let shouldFail = true;
    let listCalls = 0;
    const management: DeterministicSessionManagement = Object.freeze({
      ...base,
      inspectSession: async (
        input: Parameters<DeterministicSessionManagement['inspectSession']>[0]
      ) => {
        if (input.sessionId === 'research-session-1' && shouldFail) {
          shouldFail = false;
          return {
            failure: {
              code: 'unavailable',
              message: 'Session inspection is temporarily unavailable.',
            },
            status: 'failed',
          } as const;
        }
        return base.inspectSession(input);
      },
      listSessions: async (
        input: Parameters<DeterministicSessionManagement['listSessions']>[0]
      ) => {
        listCalls += 1;
        return base.listSessions(input);
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), management);
    await flushReact();
    clickButton(view.container, 'Load more Sessions');
    await flushReact();
    clickButtonContaining(view.container, 'Evidence review');
    await flushReact();

    expect(view.container.textContent).toContain('Session inspection is temporarily unavailable.');
    const callsBeforeRetry = listCalls;
    clickButton(view.container, 'Retry loading Session');
    await flushReact();
    clickButton(view.container, 'Session details');

    expect(view.container.querySelector('[data-slot="session-details"]')?.textContent).toContain(
      'Evidence review'
    );
    expect(listCalls).toBeGreaterThan(callsBeforeRetry);
  });

  it('enforces config and lifecycle revisions in the deterministic adapter', async () => {
    const management = createDeterministicAgentManagement();
    const inspected = await management.inspectAgent({ agentId: 'research-assistant' });
    expect(inspected.status).toBe('succeeded');
    if (inspected.status === 'failed') return;

    const updated = await management.updateAgentConfig({
      agentId: inspected.value.details.agentId,
      config: {
        ...DEFAULT_AGENT_CONFIG,
        instructions: 'Updated instructions.',
        responseStyle: 'concise',
      },
      expectedRevision: inspected.value.config.revision,
    });
    expect(updated.status).toBe('succeeded');

    const staleUpdate = await management.updateAgentConfig({
      agentId: inspected.value.details.agentId,
      config: {
        ...DEFAULT_AGENT_CONFIG,
        instructions: 'Stale instructions.',
        responseStyle: 'balanced',
      },
      expectedRevision: inspected.value.config.revision,
    });
    expect(staleUpdate).toEqual({
      status: 'failed',
      failure: {
        code: 'revision-conflict',
        currentRevision: 'revision-2',
        message: 'The Agent configuration changed after it was loaded.',
      },
    });

    const disabled = await management.disableAgent({
      agentId: inspected.value.details.agentId,
      expectedRevision: inspected.value.details.identityRevision,
    });
    expect(disabled.status).toBe('succeeded');
    if (disabled.status === 'failed') return;
    expect(disabled.value.status).toBe('disabled');
    expect(disabled.value.identityRevision).toBe('revision-2');

    const staleLifecycle = await management.reactivateAgent({
      agentId: inspected.value.details.agentId,
      expectedRevision: inspected.value.details.identityRevision,
    });
    expect(staleLifecycle.status).toBe('failed');
    if (staleLifecycle.status === 'succeeded') return;
    expect(staleLifecycle.failure.code).toBe('revision-conflict');
  });

  it('creates a new immutable identity and lists its safe projection', async () => {
    const management = createDeterministicAgentManagement();
    const created = await management.createAgent({
      config: {
        ...DEFAULT_AGENT_CONFIG,
        instructions: 'Test the system.',
        responseStyle: 'balanced',
      },
      identity: { agentId: 'test-assistant', displayName: 'Test Assistant' },
    });
    expect(created.status).toBe('succeeded');

    const listed = await management.listAgents();
    expect(listed.status).toBe('succeeded');
    if (listed.status === 'failed') return;
    expect(listed.value.map((agent) => agent.agentId)).toContain('test-assistant');
    expect(
      Object.keys(listed.value.find((agent) => agent.agentId === 'test-assistant') ?? {})
    ).toEqual(['agentId', 'displayName', 'identityRevision', 'status', 'updatedAt']);
  });

  it('propagates caller cancellation without converting it into a domain failure', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by caller'));

    await expect(
      createDeterministicAgentManagement().listAgents({ signal: controller.signal })
    ).rejects.toThrow('cancelled by caller');
  });

  it('reloads authoritative config and lifecycle revisions after conflicts', async () => {
    const management = createDeterministicAgentManagement();
    const view = renderApp(management);
    await flushReact();

    const initial = await management.inspectAgent({ agentId: 'research-assistant' });
    expect(initial.status).toBe('succeeded');
    if (initial.status === 'failed') return;
    await management.updateAgentConfig({
      agentId: 'research-assistant',
      config: {
        ...DEFAULT_AGENT_CONFIG,
        instructions: 'Authoritative instructions.',
        responseStyle: 'balanced',
      },
      expectedRevision: initial.value.config.revision,
    });

    changeValue(
      view.container.querySelector<HTMLTextAreaElement>('#settings-instructions'),
      'Stale local instructions.'
    );
    clickButton(view.container, 'Save configuration');
    await flushReact();

    expect(view.container.textContent).toContain('configuration changed after it was loaded');
    clickButton(view.container, 'Reload current version');
    await flushReact();

    expect(view.container.querySelector<HTMLTextAreaElement>('#settings-instructions')?.value).toBe(
      'Authoritative instructions.'
    );
    expect(view.container.textContent).not.toContain('configuration changed after it was loaded');
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>('#settings-instructions'),
      'Recovered configuration.'
    );
    clickButton(view.container, 'Save configuration');
    await flushReact();
    const recoveredConfig = await management.readAgentConfig({ agentId: 'research-assistant' });
    expect(recoveredConfig).toMatchObject({
      status: 'succeeded',
      value: { revision: 'revision-3', value: { instructions: 'Recovered configuration.' } },
    });

    const beforeLifecycle = await management.inspectAgent({ agentId: 'research-assistant' });
    expect(beforeLifecycle.status).toBe('succeeded');
    if (beforeLifecycle.status === 'failed') return;
    await management.disableAgent({
      agentId: 'research-assistant',
      expectedRevision: beforeLifecycle.value.details.identityRevision,
    });

    clickButton(view.container, 'Disable Agent');
    clickButton(document.body, 'Disable Agent', 'dialog');
    await flushReact();

    expect(document.body.textContent).toContain('lifecycle changed after it was loaded');
    clickButton(view.container, 'Reload current lifecycle');
    await flushReact();
    expect(view.container.textContent).toContain('Reactivate Agent');
    expect(view.container.textContent).not.toContain('lifecycle changed after it was loaded');
    clickButton(view.container, 'Reactivate Agent');
    await flushReact();
    const recoveredLifecycle = await management.inspectAgent({ agentId: 'research-assistant' });
    expect(recoveredLifecycle).toMatchObject({
      status: 'succeeded',
      value: { details: { identityRevision: 'revision-3', status: 'active' } },
    });
  });

  it('preserves newer draft edits while adopting the saved authoritative revision', async () => {
    const base = createDeterministicAgentManagement();
    const pending = createDeferred<void>();
    const management: DeterministicAgentManagement = {
      ...base,
      updateAgentConfig: async (input) => {
        await pending.promise;
        return base.updateAgentConfig(input);
      },
    };
    const view = renderApp(management);
    await flushReact();
    const instructions =
      view.container.querySelector<HTMLTextAreaElement>('#settings-instructions');
    changeValue(instructions, 'Submitted configuration.');
    clickButton(view.container, 'Save configuration');
    changeValue(instructions, 'Newer unsaved configuration.');
    pending.resolve();
    await flushReact();
    expect(instructions?.value).toBe('Newer unsaved configuration.');
    expect(
      view.container.querySelector('[data-slot="agent-config-form"]')?.getAttribute('data-dirty')
    ).toBe('true');
    const saved = await management.readAgentConfig({ agentId: 'research-assistant' });
    expect(saved).toMatchObject({
      status: 'succeeded',
      value: { revision: 'revision-2', value: { instructions: 'Submitted configuration.' } },
    });
    clickButton(view.container, 'Discard changes');
    await flushReact();
    expect(instructions?.value).toBe('Submitted configuration.');
    expect(
      view.container.querySelector('[data-slot="agent-config-form"]')?.hasAttribute('data-dirty')
    ).toBe(false);
  });

  it('does not let a delayed mutation replace a newer Agent selection', async () => {
    const base = createDeterministicAgentManagement();
    const pending = createDeferred<void>();
    const pendingLifecycle = createDeferred<void>();
    const management: DeterministicAgentManagement = Object.freeze({
      ...base,
      reactivateAgent: async (
        input: Parameters<DeterministicAgentManagement['reactivateAgent']>[0]
      ) => {
        await pendingLifecycle.promise;
        return base.reactivateAgent(input);
      },
      updateAgentConfig: async (
        input: Parameters<DeterministicAgentManagement['updateAgentConfig']>[0]
      ) => {
        await pending.promise;
        return base.updateAgentConfig(input);
      },
    });
    const view = renderApp(management);
    await flushReact();

    changeValue(
      view.container.querySelector<HTMLTextAreaElement>('#settings-instructions'),
      'Delayed update.'
    );
    clickButton(view.container, 'Save configuration');
    const reviewButton = [...view.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('Review Assistant')
    );
    if (reviewButton === undefined) throw new Error('Expected Review Assistant button to exist.');
    act(() => reviewButton.click());
    await flushReact();
    expect(view.container.querySelector('[data-slot="agent-details"]')?.textContent).toContain(
      'Review Assistant'
    );

    pending.resolve();
    await flushReact();

    expect(view.container.querySelector('[data-slot="agent-details"]')?.textContent).toContain(
      'Review Assistant'
    );
    expect(
      view.container.querySelector('[data-slot="agent-list-item"][data-selected="true"]')
        ?.textContent
    ).toContain('Review Assistant');

    clickButton(view.container, 'Reactivate Agent');
    const researchButton = [...view.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('Research Assistant')
    );
    if (researchButton === undefined) {
      throw new Error('Expected Research Assistant button to exist.');
    }
    act(() => researchButton.click());
    await flushReact();
    expect(view.container.querySelector('[data-slot="agent-details"]')?.textContent).toContain(
      'Research Assistant'
    );

    pendingLifecycle.resolve();
    await flushReact();
    expect(view.container.querySelector('[data-slot="agent-details"]')?.textContent).toContain(
      'Research Assistant'
    );
  });

  it('keeps validation feedback scoped to the operation and field', async () => {
    const view = renderApp();
    await flushReact();

    changeValue(view.container.querySelector<HTMLTextAreaElement>('#settings-instructions'), '   ');
    clickButton(view.container, 'Save configuration');
    await flushReact();
    expect(
      view.container
        .querySelector<HTMLTextAreaElement>('#settings-instructions')
        ?.getAttribute('aria-invalid')
    ).toBe('true');
    expect(view.container.textContent).toContain('Enter a valid instructions.');

    clickButton(view.container, 'Disable Agent');
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-slot="dialog"]');
    expect(dialog?.textContent).not.toContain('Agent configuration is invalid');
  });

  it('projects structured creation validation onto the owned identity fields', async () => {
    const view = renderApp();
    await flushReact();
    clickButton(view.container, 'Create Agent');

    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-slot="dialog"]');
    const agentId = dialog?.querySelector<HTMLInputElement>('input[name="agentId"]') ?? null;
    const displayName =
      dialog?.querySelector<HTMLInputElement>('input[name="displayName"]') ?? null;
    changeValue(agentId, '   ');
    changeValue(displayName, '   ');
    clickButton(document.body, 'Create Agent', 'dialog');
    await flushReact();

    expect(agentId?.getAttribute('aria-invalid')).toBe('true');
    expect(displayName?.getAttribute('aria-invalid')).toBe('true');
    expect(dialog?.textContent).toContain('Agent ID is required.');
    expect(dialog?.textContent).toContain('Display name is required.');

    changeValue(agentId, 'new-agent');
    expect(agentId?.getAttribute('aria-invalid')).toBeNull();
    expect(displayName?.getAttribute('aria-invalid')).toBe('true');
  });

  it('loads paged conversation history and preserves model-turn reasoning through a tool loop', async () => {
    const sessions = createDeterministicSessionManagement();
    const conversations = createDeterministicConversationManagement(sessions, {
      pace: () => Promise.resolve(),
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);

    expect(view.container.textContent).toContain('What remains uncertain?');
    clickButton(view.container, 'Load older turns');
    await flushReact();
    expect(view.container.textContent).toContain('How should I review this evidence?');

    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Use a tool'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    const turns = view.container.querySelectorAll('[data-slot="conversation-turn"]');
    const latest = turns.item(turns.length - 1);
    expect(latest.getAttribute('data-state')).toBe('completed');
    expect(latest.querySelectorAll('[data-slot="reasoning-block"]')).toHaveLength(2);
    expect(latest.querySelectorAll('[data-model-turn-index]')).not.toHaveLength(0);
    expect(latest.querySelector('[data-slot="tool-activity"]')?.textContent).toContain(
      'Evidence lookup'
    );
    expect(latest.textContent).toContain('The tool confirmed the requested result.');

    clickButton(view.container, 'Load more Sessions');
    await flushReact();
    clickButtonContaining(view.container, 'Source comparison');
    await flushReact();
    clickButtonContaining(view.container, 'Evidence review');
    await flushReact();
    expect(view.container.textContent).toContain('The tool confirmed the requested result.');
  });

  it('admits a draft into a persisted Session and reconciles its completed first turn', async () => {
    const sessions = createDeterministicSessionManagement();
    const conversations = createDeterministicConversationManagement(sessions, {
      pace: () => Promise.resolve(),
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await flushReact();

    clickButton(view.container, 'New');
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'A new topic'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    expect(view.container.querySelector('[data-session-draft]')).toBeNull();
    clickButton(view.container, 'Session details');
    expect(view.container.querySelector('[data-slot="session-details"]')?.textContent).toContain(
      'A new topic'
    );
    expect(view.container.textContent).toContain('Deterministic response to: A new topic');
  });

  it('accepts a completed reasoning-only turn without fabricating assistant text', async () => {
    const sessions = createDeterministicSessionManagement();
    const conversations = createDeterministicConversationManagement(sessions, {
      pace: () => Promise.resolve(),
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);

    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Reasoning only'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    const turns = view.container.querySelectorAll('[data-slot="conversation-turn"]');
    const latest = turns.item(turns.length - 1);
    expect(latest.getAttribute('data-state')).toBe('completed');
    expect(latest.querySelector('[data-slot="reasoning-block"]')?.textContent).toContain(
      'I am preparing a bounded response.'
    );
    expect(latest.querySelector('[data-slot="assistant-message"]')).toBeNull();
  });

  it('keeps failed and cancelled partial output visible without committing a successful turn', async () => {
    const sessions = createDeterministicSessionManagement();
    const immediate = createDeterministicConversationManagement(sessions, {
      pace: () => Promise.resolve(),
    });
    const failedView = renderApp(createDeterministicAgentManagement(), sessions, immediate);
    await selectEvidenceReview(failedView.container);
    const beforeFailure = await immediate.readConversation({
      agentId: 'research-assistant',
      branchId: 'main',
      limit: 20,
      sessionId: 'research-session-1',
    });

    changeValue(
      failedView.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Please fail'
    );
    clickButton(failedView.container, 'Send');
    await flushReact();
    const failedTurn = failedView.container.querySelector(
      '[data-slot="conversation-turn"][data-state="failed"]'
    );
    expect(failedTurn?.textContent).toContain('I could not complete this request.');
    expect(failedTurn?.textContent).toContain('Incomplete');
    const afterFailure = await immediate.readConversation({
      agentId: 'research-assistant',
      branchId: 'main',
      limit: 20,
      sessionId: 'research-session-1',
    });
    expect(afterFailure).toEqual(beforeFailure);

    cleanupMountedView(failedView);
    const cancellable = createDeterministicConversationManagement(sessions);
    const cancelledView = renderApp(createDeterministicAgentManagement(), sessions, cancellable);
    await selectEvidenceReview(cancelledView.container);
    changeValue(
      cancelledView.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Cancel me'
    );
    clickButton(cancelledView.container, 'Send');
    clickButton(cancelledView.container, 'Cancel response');
    await flushReact();
    expect(
      cancelledView.container.querySelector(
        '[data-slot="conversation-turn"][data-state="cancelled"]'
      )
    ).not.toBeNull();
  });

  it('keeps streaming and cancelled partial output visible while history is still loading', async () => {
    const sessions = createDeterministicSessionManagement();
    const base = createDeterministicConversationManagement(sessions, {
      pace: () => Promise.resolve(),
    });
    const historyGate = createDeferred<void>();
    const conversations: DeterministicConversationManagement = Object.freeze({
      ...base,
      readConversation: async (
        input: Parameters<DeterministicConversationManagement['readConversation']>[0]
      ) => {
        if (input.branchId === 'alternative') await historyGate.promise;
        return base.readConversation(input);
      },
      streamInteraction: async (
        input: Parameters<DeterministicConversationManagement['streamInteraction']>[0],
        consume: Parameters<DeterministicConversationManagement['streamInteraction']>[1]
      ) => {
        await consume({ interactionId: input.interactionId, type: 'interaction-started' });
        await consume({
          activity: {
            callId: 'pending-tool',
            details: [],
            modelTurnIndex: 1,
            status: 'pending',
            toolLabel: 'Evidence lookup',
          },
          interactionId: input.interactionId,
          type: 'tool-activity-updated',
        });
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) {
            resolve();
            return;
          }
          input.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        await consume({ interactionId: input.interactionId, type: 'cancelled' });
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);
    clickButtonContaining(view.container, 'alternative');
    await flushReact();
    expect(view.container.textContent).toContain('Loading conversation…');

    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Use a pending tool'
    );
    clickButton(view.container, 'Send');
    await flushReact();
    expect(
      view.container.querySelector('[data-slot="conversation-turn"][data-state="streaming"]')
    ).not.toBeNull();
    expect(view.container.querySelector('[data-slot="tool-activity"]')?.textContent).toContain(
      'Running'
    );
    expect(view.container.textContent).toContain('Loading conversation…');

    clickButton(view.container, 'Cancel response');
    await flushReact();
    const cancelledTurn = view.container.querySelector(
      '[data-slot="conversation-turn"][data-state="cancelled"]'
    );
    expect(cancelledTurn).not.toBeNull();
    expect(cancelledTurn?.querySelector('[data-slot="tool-activity"]')?.textContent).toContain(
      'Interrupted'
    );
    expect(cancelledTurn?.textContent).not.toContain('Running');
    expect(view.container.textContent).toContain('Loading conversation…');

    historyGate.resolve();
    await flushReact();
  });

  it('keeps failed partial output visible beside a history failure', async () => {
    const sessions = createDeterministicSessionManagement();
    const base = createDeterministicConversationManagement(sessions, {
      pace: () => Promise.resolve(),
    });
    const conversations: DeterministicConversationManagement = Object.freeze({
      ...base,
      readConversation: async (
        input: Parameters<DeterministicConversationManagement['readConversation']>[0]
      ) =>
        input.branchId === 'alternative'
          ? {
              failure: {
                code: 'unavailable' as const,
                message: 'History is temporarily unavailable.',
              },
              status: 'failed' as const,
            }
          : base.readConversation(input),
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);
    clickButtonContaining(view.container, 'alternative');
    await flushReact();
    expect(view.container.textContent).toContain('History is temporarily unavailable.');

    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Please fail'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    const failedTurn = view.container.querySelector(
      '[data-slot="conversation-turn"][data-state="failed"]'
    );
    expect(failedTurn?.textContent).toContain('I could not complete this request.');
    expect(view.container.textContent).toContain('History is temporarily unavailable.');
  });

  it('restores persisted Composer drafts per target and discards an abandoned new draft', async () => {
    const view = renderApp();
    await selectEvidenceReview(view.container);
    const composer = () =>
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      );

    changeValue(composer(), 'Main branch draft');
    clickButtonContaining(view.container, 'alternative');
    await flushReact();
    expect(composer()?.value).toBe('');

    changeValue(composer(), 'Alternative branch draft');
    clickButtonContaining(view.container, 'main');
    await flushReact();
    expect(composer()?.value).toBe('Main branch draft');
    clickButtonContaining(view.container, 'alternative');
    await flushReact();
    expect(composer()?.value).toBe('Alternative branch draft');

    clickButton(view.container, 'New');
    await flushReact();
    expect(composer()?.value).toBe('');
    changeValue(composer(), 'Unpersisted draft');
    clickButtonContaining(view.container, 'Evidence review');
    await flushReact();
    clickButton(view.container, 'New');
    await flushReact();
    expect(composer()?.value).toBe('');

    clickButtonContaining(view.container, 'Evidence review');
    await flushReact();
    clickButtonContaining(view.container, 'Review Assistant');
    await flushReact();
    clickButtonContaining(view.container, 'Research Assistant');
    await selectEvidenceReview(view.container);
    clickButtonContaining(view.container, 'alternative');
    await flushReact();
    expect(composer()?.value).toBe('Alternative branch draft');
  });

  it('keeps a persisted interaction alive when Agent selection changes', async () => {
    const sessions = createDeterministicSessionManagement();
    const base = createDeterministicConversationManagement(sessions);
    const release = createDeferred<void>();
    let aborted = false;
    const conversations: DeterministicConversationManagement = Object.freeze({
      ...base,
      streamInteraction: async (
        input: Parameters<DeterministicConversationManagement['streamInteraction']>[0],
        consume: Parameters<DeterministicConversationManagement['streamInteraction']>[1]
      ) => {
        await consume({ interactionId: input.interactionId, type: 'interaction-started' });
        await consume({
          delta: 'Partial reasoning',
          interactionId: input.interactionId,
          modelTurnIndex: 1,
          type: 'reasoning-delta',
        });
        input.signal?.addEventListener('abort', () => {
          aborted = true;
        });
        await release.promise;
        await consume({
          delta: 'Background completion',
          interactionId: input.interactionId,
          modelTurnIndex: 1,
          type: 'text-delta',
        });
        const timestamp = '2026-02-01T00:20:00.000Z';
        await consume({
          interactionId: input.interactionId,
          sessionId: input.session?.sessionId ?? 'unexpected-session',
          turn: {
            assistantMessage: {
              reasoningBlocks: [{ modelTurnIndex: 1, text: 'Partial reasoning' }],
              text: 'Background completion',
              timestamp,
              toolActivities: [],
            },
            branchId: input.session?.branchId ?? 'main',
            status: 'completed',
            turnId: 'background-turn',
            userMessage: { text: input.message, timestamp },
          },
          type: 'completed',
        });
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Keep working'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    clickButtonContaining(view.container, 'Review Assistant');
    await flushReact();
    expect(aborted).toBe(false);
    expect(view.container.querySelector('[data-slot="app-shell-header"]')?.textContent).toContain(
      'Review Assistant'
    );
    expect(view.container.textContent).not.toContain('Partial reasoning');

    release.resolve();
    await flushReact();
    expect(aborted).toBe(false);
    clickButtonContaining(view.container, 'Research Assistant');
    await selectEvidenceReview(view.container);
    expect(view.container.textContent).toContain('Background completion');
  });

  it('runs persisted Session targets concurrently and cancels only the selected target', async () => {
    const sessions = createDeterministicSessionManagement();
    const base = createDeterministicConversationManagement(sessions);
    const firstRelease = createDeferred<void>();
    let firstAborted = false;
    const conversations: DeterministicConversationManagement = Object.freeze({
      ...base,
      streamInteraction: async (
        input: Parameters<DeterministicConversationManagement['streamInteraction']>[0],
        consume: Parameters<DeterministicConversationManagement['streamInteraction']>[1]
      ) => {
        const sessionId = input.session?.sessionId;
        await consume({ interactionId: input.interactionId, type: 'interaction-started' });
        await consume({
          delta: `Working in ${sessionId ?? 'draft'}`,
          interactionId: input.interactionId,
          modelTurnIndex: 1,
          type: 'reasoning-delta',
        });
        if (sessionId === 'research-session-1') {
          input.signal?.addEventListener('abort', () => {
            firstAborted = true;
          });
          await firstRelease.promise;
          await consume({
            delta: 'First Session completed',
            interactionId: input.interactionId,
            modelTurnIndex: 1,
            type: 'text-delta',
          });
          const timestamp = '2026-02-01T00:21:00.000Z';
          await consume({
            interactionId: input.interactionId,
            sessionId,
            turn: {
              assistantMessage: {
                reasoningBlocks: [{ modelTurnIndex: 1, text: `Working in ${sessionId}` }],
                text: 'First Session completed',
                timestamp,
                toolActivities: [],
              },
              branchId: input.session?.branchId ?? 'main',
              status: 'completed',
              turnId: 'concurrent-first-turn',
              userMessage: { text: input.message, timestamp },
            },
            type: 'completed',
          });
          return;
        }
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) {
            resolve();
            return;
          }
          input.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        await consume({ interactionId: input.interactionId, type: 'cancelled' });
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'First target'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    clickButtonContaining(view.container, 'Source comparison');
    await flushReact();
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Second target'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    expect(
      view.container.querySelectorAll('[data-slot="session-list-item"][data-working]')
    ).toHaveLength(2);
    clickButton(view.container, 'Cancel response');
    await flushReact();
    expect(firstAborted).toBe(false);
    expect(
      view.container.querySelector('[data-slot="conversation-turn"][data-state="cancelled"]')
    ).not.toBeNull();

    firstRelease.resolve();
    await flushReact();
    await flushReact();
    clickButton(view.container, 'Load more Sessions');
    await flushReact();
    clickButtonContaining(view.container, 'Evidence review');
    await flushReact();
    expect(view.container.textContent).toContain('First Session completed');
  });

  it('keeps interactions isolated across branches of the same Session', async () => {
    const sessions = createDeterministicSessionManagement();
    const base = createDeterministicConversationManagement(sessions);
    const mainRelease = createDeferred<void>();
    const alternativeRelease = createDeferred<void>();
    const conversations: DeterministicConversationManagement = Object.freeze({
      ...base,
      streamInteraction: async (
        input: Parameters<DeterministicConversationManagement['streamInteraction']>[0],
        consume: Parameters<DeterministicConversationManagement['streamInteraction']>[1]
      ) => {
        const branchId = input.session?.branchId ?? 'main';
        await consume({ interactionId: input.interactionId, type: 'interaction-started' });
        await consume({
          delta: `${branchId} reasoning`,
          interactionId: input.interactionId,
          modelTurnIndex: 1,
          type: 'reasoning-delta',
        });
        const release = branchId === 'main' ? mainRelease : alternativeRelease;
        await Promise.race([
          release.promise,
          new Promise<void>((resolve) => {
            input.signal?.addEventListener('abort', () => resolve(), { once: true });
          }),
        ]);
        if (input.signal?.aborted) {
          await consume({ interactionId: input.interactionId, type: 'cancelled' });
          return;
        }
        const answer = `${branchId} completion`;
        await consume({
          delta: answer,
          interactionId: input.interactionId,
          modelTurnIndex: 1,
          type: 'text-delta',
        });
        const timestamp = '2026-02-01T00:22:00.000Z';
        await consume({
          interactionId: input.interactionId,
          sessionId: input.session?.sessionId ?? 'unexpected-session',
          turn: {
            assistantMessage: {
              reasoningBlocks: [{ modelTurnIndex: 1, text: `${branchId} reasoning` }],
              text: answer,
              timestamp,
              toolActivities: [],
            },
            branchId,
            status: 'completed',
            turnId: `${branchId}-concurrent-turn`,
            userMessage: { text: input.message, timestamp },
          },
          type: 'completed',
        });
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Main work'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    clickButtonContaining(view.container, 'alternative');
    await flushReact();
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Alternative work'
    );
    clickButton(view.container, 'Send');
    await flushReact();
    expect(view.container.textContent).toContain('alternative reasoning');

    clickButton(view.container, 'Cancel response');
    alternativeRelease.resolve();
    await flushReact();
    clickButtonContaining(view.container, 'main');
    await flushReact();
    expect(view.container.textContent).toContain('main reasoning');
    expect(
      view.container.querySelector('[data-slot="conversation-turn"][data-state="streaming"]')
    ).not.toBeNull();

    mainRelease.resolve();
    await flushReact();
    expect(view.container.textContent).toContain('main completion');
  });

  it('cancels every application-owned conversation operation on unmount', async () => {
    const sessions = createDeterministicSessionManagement();
    const base = createDeterministicConversationManagement(sessions);
    const aborted = createDeferred<void>();
    const conversations: DeterministicConversationManagement = Object.freeze({
      ...base,
      streamInteraction: async (
        input: Parameters<DeterministicConversationManagement['streamInteraction']>[0],
        consume: Parameters<DeterministicConversationManagement['streamInteraction']>[1]
      ) => {
        await consume({ interactionId: input.interactionId, type: 'interaction-started' });
        await new Promise<void>((resolve) => {
          const handleAbort = () => {
            aborted.resolve();
            resolve();
          };
          if (input.signal?.aborted) handleAbort();
          else input.signal?.addEventListener('abort', handleAbort, { once: true });
        });
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Keep running until unmount'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    cleanupMountedView(view);
    await aborted.promise;
  });

  it('locks protocol failure even when an adapter swallows a post-terminal event rejection', async () => {
    const sessions = createDeterministicSessionManagement();
    const base = createDeterministicConversationManagement(sessions);
    const conversations: DeterministicConversationManagement = Object.freeze({
      ...base,
      streamInteraction: async (
        input: Parameters<DeterministicConversationManagement['streamInteraction']>[0],
        consume: Parameters<DeterministicConversationManagement['streamInteraction']>[1]
      ) => {
        const timestamp = '2026-02-01T00:10:00.000Z';
        await consume({ interactionId: input.interactionId, type: 'interaction-started' });
        await consume({
          delta: 'Accepted answer',
          interactionId: input.interactionId,
          modelTurnIndex: 1,
          type: 'text-delta',
        });
        await consume({
          interactionId: input.interactionId,
          sessionId: input.session?.sessionId ?? 'unexpected-session',
          turn: {
            assistantMessage: {
              reasoningBlocks: [],
              text: 'Accepted answer',
              timestamp,
              toolActivities: [],
            },
            branchId: input.session?.branchId ?? 'main',
            status: 'completed',
            turnId: 'invalid-terminal-turn',
            userMessage: { text: input.message, timestamp },
          },
          type: 'completed',
        });
        try {
          await consume({
            delta: 'late output',
            interactionId: input.interactionId,
            modelTurnIndex: 1,
            type: 'text-delta',
          });
        } catch {
          // Deliberately emulate a broken adapter swallowing consumer rejection.
        }
      },
    });
    const view = renderApp(createDeterministicAgentManagement(), sessions, conversations);
    await selectEvidenceReview(view.container);
    changeValue(
      view.container.querySelector<HTMLTextAreaElement>(
        '[data-slot="conversation-composer"] textarea'
      ),
      'Protocol test'
    );
    clickButton(view.container, 'Send');
    await flushReact();

    const failed = view.container.querySelector(
      '[data-slot="conversation-turn"][data-state="failed"]'
    );
    expect(failed?.textContent).toContain('Interaction event arrived after the terminal event.');
    expect(failed?.textContent).not.toContain('late output');
  });

  it('creates non-destructive fork and rewind branches from explicit turns', async () => {
    const sessions = createDeterministicSessionManagement();
    const conversations = createDeterministicConversationManagement(sessions);
    const initial = await sessions.inspectSessionNavigation({
      agentId: 'research-assistant',
      sessionId: 'research-session-1',
    });
    expect(initial.status).toBe('succeeded');
    if (initial.status === 'failed') return;
    expect(
      await conversations.readConversation({
        agentId: 'review-assistant',
        branchId: 'main',
        sessionId: 'research-session-1',
      })
    ).toMatchObject({ failure: { code: 'not-found' }, status: 'failed' });

    const forked = await conversations.forkSessionBranch({
      agentId: 'research-assistant',
      expectedRevision: initial.value.revision,
      sessionId: 'research-session-1',
      sourceBranchId: 'main',
      throughTurnId: 'turn-2',
    });
    expect(forked.status).toBe('succeeded');
    if (forked.status === 'failed') return;
    expect(forked.value.navigation.selectedBranchId).toBe('main');

    const rewound = await conversations.rewindSessionBranch({
      agentId: 'research-assistant',
      expectedRevision: forked.value.navigation.revision,
      sessionId: 'research-session-1',
      throughTurnId: 'turn-2',
    });
    expect(rewound.status).toBe('succeeded');
    if (rewound.status === 'failed') return;
    expect(rewound.value.navigation.selectedBranchId).toBe(rewound.value.affectedBranchId);

    const original = await conversations.readConversation({
      agentId: 'research-assistant',
      branchId: 'main',
      limit: 20,
      sessionId: 'research-session-1',
    });
    const rewindHistory = await conversations.readConversation({
      agentId: 'research-assistant',
      branchId: rewound.value.affectedBranchId,
      limit: 20,
      sessionId: 'research-session-1',
    });
    expect(original.status === 'succeeded' ? original.value.turns.length : 0).toBe(3);
    expect(rewindHistory.status === 'succeeded' ? rewindHistory.value.turns.length : 0).toBe(2);
  });

  it('bundles the optional default stylesheet through its public package export', () => {
    const publicRoot = join(import.meta.dirname, '../../dist/public');
    const assetsRoot = join(publicRoot, 'assets');
    const cssAsset = readdirSync(assetsRoot).find((name) => name.endsWith('.css'));

    expect(cssAsset).toBeDefined();
    const css = readFileSync(join(assetsRoot, cssAsset ?? ''), 'utf8');
    expect(css).toContain('--ta-ui-color-canvas');
    expect(css).toContain('.ta-ui-agent-catalog');
    expect(css).toContain('.ta-ui-agent-config-form');
    expect(css).toContain('.ta-ui-session-catalog');
    expect(css).toContain('.ta-ui-conversation-turn');
    expect(readFileSync(join(publicRoot, 'index.html'), 'utf8')).toContain('Agent Web');
  });
});

function renderApp(
  agentManagement: DeterministicAgentManagement = createDeterministicAgentManagement(),
  sessionManagement: DeterministicSessionManagement = createDeterministicSessionManagement(),
  conversationManagement: DeterministicConversationManagement = createDeterministicConversationManagement(
    sessionManagement
  )
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.add(root);
  act(() =>
    root.render(
      <App
        requestedLocation={{ agentId: 'research-assistant', view: 'settings' }}
        ports={{
          agents: agentManagement,
          conversations: conversationManagement,
          sessions: sessionManagement,
        }}
      />
    )
  );
  return { container, root };
}

function cleanupMountedView(view: Readonly<{ container: HTMLDivElement; root: Root }>) {
  act(() => view.root.unmount());
  mountedRoots.delete(view.root);
  view.container.remove();
}

function changeValue(control: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (control === null) throw new Error('Expected form control to exist.');
  act(() => {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickButton(container: ParentNode, label: string, ancestorSlot?: string) {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
  const button = buttons.find(
    (candidate) =>
      candidate.textContent?.trim() === label &&
      (ancestorSlot === undefined || candidate.closest(`[data-slot="${ancestorSlot}"]`) !== null)
  );
  if (button === undefined) throw new Error(`Expected button '${label}' to exist.`);
  act(() => button.click());
}

function clickButtonContaining(container: ParentNode, text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (button === undefined) throw new Error(`Expected a button containing '${text}' to exist.`);
  act(() => button.click());
}

async function selectEvidenceReview(container: ParentNode) {
  await flushReact();
  clickButton(container, 'Load more Sessions');
  await flushReact();
  clickButtonContaining(container, 'Evidence review');
  await flushReact();
  if (container.querySelector('[data-slot="app-shell-inspector"]') === null)
    clickButton(container, 'Session details');
}

function createDeferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}
