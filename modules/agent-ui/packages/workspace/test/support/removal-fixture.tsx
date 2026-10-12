import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import type { AgentDetails, WorkspacePorts } from '@ta-agent/ui-contracts';
import {
  BrowserAgentWorkspace,
  type WorkspaceExtensionProps,
  type WorkspaceExtension,
} from '../../src/index.js';
import { researchBackend } from '../qualification/research-backend.js';

export async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}
export function button(label: string) {
  const element = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label
  );
  if (element === undefined) throw new Error(`Missing button: ${label}`);
  return element;
}
export function click(label: string) {
  act(() => button(label).click());
}
export function choose(id: string) {
  const item = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-slot="agent-list-item"] button'),
  ].find((node) => node.textContent?.includes(`Research ${id}`));
  if (item === undefined) throw new Error(`Missing Agent: ${id}`);
  act(() => item.click());
}
export function editMessage(text: string) {
  const input = document.querySelector('textarea');
  if (input === null) throw new Error('Missing composer.');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export function navigate(hash: string) {
  act(() => {
    window.history.pushState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

export function removalFixture() {
  const backend = researchBackend();
  const timestamp = '2026-10-11T00:00:00Z';
  const details = new Map<string, AgentDetails>(
    ['alpha', 'beta', 'gamma'].map((agentId) => [
      agentId,
      {
        agentId,
        displayName: `Research ${agentId}`,
        identityRevision: '1',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ])
  );
  const list = vi.fn<WorkspacePorts['agents']['listAgentPage']>(() =>
    Promise.resolve({ status: 'succeeded', value: { records: [...details.values()] } })
  );
  const inspect = vi.fn<WorkspacePorts['agents']['inspectAgentDetails']>(({ agentId }) => {
    const value = details.get(agentId);
    return Promise.resolve(
      value === undefined
        ? { status: 'failed', failure: { code: 'not-found', message: 'Unknown Agent.' } }
        : { status: 'succeeded', value }
    );
  });
  const ports: WorkspacePorts = {
    ...backend.ports,
    agents: { listAgentPage: list, inspectAgentDetails: inspect },
  };
  const discard = vi.fn();
  const boundary = { dirty: false, working: false, editIdentity: undefined, discard };
  let latest: WorkspaceExtensionProps | undefined;
  const extension: WorkspaceExtension = (props) => {
    latest = props;
    return props.children({
      boundary,
      // Deliberately leave stale surface nodes supplied: Workspace owns their visibility.
      settings: <p data-testid="product-settings">Product settings for {props.agent?.agentId}</p>,
      inspector: <p data-testid="product-inspector">Product inspector</p>,
    });
  };
  return {
    backend,
    ports,
    details,
    list,
    inspect,
    discard,
    boundary,
    extension,
    get extensionProps() {
      if (latest === undefined) throw new Error('Extension not mounted.');
      return latest;
    },
  };
}

export async function mountWorkspace(
  fixture: ReturnType<typeof removalFixture>,
  collection?: string
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (next = fixture, key = collection) =>
    act(() =>
      root.render(
        <BrowserAgentWorkspace
          key={key}
          ports={next.ports}
          extension={next.extension}
          profileLabel="Test workspace"
          {...(key === undefined ? {} : { collectionKey: key })}
        />
      )
    );
  render();
  await flush();
  return {
    render,
    unmount: () => act(() => root.unmount()),
  };
}
