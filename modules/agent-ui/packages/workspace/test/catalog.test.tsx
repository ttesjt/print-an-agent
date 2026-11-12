import { afterEach, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AgentDetails, WorkspaceAgentPort } from '@print-an-agent/ui-contracts';
import { useWorkspaceAgents } from '../src/agent/use-workspace-agents.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
const agent = (agentId: string): AgentDetails => ({
  agentId,
  displayName: agentId,
  status: 'active',
  identityRevision: 'identity',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
async function mount(port: WorkspaceAgentPort, selectedId?: string) {
  let controller: ReturnType<typeof useWorkspaceAgents> | undefined;
  function Probe() {
    controller = useWorkspaceAgents(
      port,
      selectedId === undefined ? undefined : { agentId: selectedId }
    );
    return null;
  }
  const element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
  await act(async () => {
    root?.render(<Probe />);
    await Promise.resolve();
  });
  return () => {
    if (controller === undefined) throw new Error('Not mounted');
    return controller;
  };
}
it('pages and deduplicates without replacing a deep-linked selection outside the loaded pages', async () => {
  const calls: (string | undefined)[] = [];
  const read = await mount(
    {
      listAgentPage: ({ cursor }) => {
        calls.push(cursor);
        return Promise.resolve({
          status: 'succeeded',
          value:
            cursor === undefined
              ? { records: [agent('a')], nextCursor: 'second' }
              : { records: [agent('a'), agent('b')] },
        });
      },
      inspectAgentDetails: ({ agentId }) =>
        Promise.resolve({ status: 'succeeded', value: agent(agentId) }),
    },
    'outside'
  );
  expect(read().selected?.agentId).toBe('outside');
  await act(() => read().loadMore());
  expect(read().catalogState).toMatchObject({ agents: [{ agentId: 'a' }, { agentId: 'b' }] });
  expect(read().selectedAgentId).toBe('outside');
  expect(calls).toEqual([undefined, 'second']);
});
it('rejects a nonadvancing cursor while retaining loaded records for retry', async () => {
  const read = await mount({
    listAgentPage: () =>
      Promise.resolve({
        status: 'succeeded',
        value: { records: [agent('a')], nextCursor: 'same' },
      }),
    inspectAgentDetails: () => Promise.resolve({ status: 'succeeded', value: agent('a') }),
  });
  await act(() => read().loadMore());
  expect(read().pageError).toContain('repeated cursor');
  expect(read().catalogState).toMatchObject({ agents: [{ agentId: 'a' }] });
});

it('acquires pagination synchronously and rejects a cursor cycle across multiple pages', async () => {
  const calls: (string | undefined)[] = [];
  const read = await mount({
    listAgentPage: ({ cursor }) => {
      calls.push(cursor);
      return Promise.resolve({
        status: 'succeeded',
        value: {
          records: [agent(cursor ?? 'first')],
          nextCursor: cursor === 'second' ? 'third' : 'second',
        },
      });
    },
    inspectAgentDetails: () => Promise.resolve({ status: 'succeeded', value: agent('first') }),
  });
  await act(async () => {
    const one = read().loadMore();
    const two = read().loadMore();
    await Promise.all([one, two]);
  });
  expect(calls).toEqual([undefined, 'second']);
  await act(() => read().loadMore());
  expect(read().pageError).toContain('repeated cursor');
  expect(read().catalogState).toMatchObject({
    agents: [{ agentId: 'first' }, { agentId: 'second' }],
  });
});

it.each(['a', 'b'])(
  'only invalidates lifecycle work owned by removed Agent %s',
  async (removedId) => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<NonNullable<WorkspaceAgentPort['disableAgent']>>>>();
    let signal: AbortSignal | undefined;
    const read = await mount({
      listAgentPage: () =>
        Promise.resolve({ status: 'succeeded', value: { records: [agent('a'), agent('b')] } }),
      inspectAgentDetails: ({ agentId }) =>
        Promise.resolve({ status: 'succeeded', value: agent(agentId) }),
      disableAgent: (input) => {
        signal = input.signal;
        return pending.promise;
      },
    });
    let work: Promise<void> | undefined;
    act(() => {
      work = read().changeLifecycle('disabled');
    });
    act(() => {
      read().removeAgent(removedId);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(signal?.aborted).toBe(removedId === 'a');
    expect(read().lifecycleWorking).toBe(removedId !== 'a');
    await act(async () => {
      pending.resolve({ status: 'succeeded', value: { ...agent('a'), status: 'disabled' } });
      await work;
    });
    expect(read().selectedAgentId).toBe(removedId === 'a' ? undefined : 'a');
  }
);

it('rejects a late pagination page after removal and revives an ID only on explicit creation', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<WorkspaceAgentPort['listAgentPage']>>>();
  let signal: AbortSignal | undefined;
  const read = await mount({
    listAgentPage: (input) => {
      if (input.cursor !== undefined) {
        signal = input.signal;
        return pending.promise;
      }
      return Promise.resolve({
        status: 'succeeded',
        value: { records: [agent('a')], nextCursor: 'next' },
      });
    },
    inspectAgentDetails: ({ agentId }) =>
      Promise.resolve({ status: 'succeeded', value: agent(agentId) }),
  });
  let work: Promise<void> | undefined;
  act(() => {
    work = read().loadMore();
  });
  act(() => {
    read().removeAgent('a');
  });
  await act(async () => {
    pending.resolve({ status: 'succeeded', value: { records: [agent('a'), agent('b')] } });
    await work;
  });
  expect(signal?.aborted).toBe(true);
  expect(read().selectedAgentId).toBeUndefined();
  expect(read().catalogState).toMatchObject({ status: 'ready', agents: [] });
  await act(async () => {
    read().createdAgent('a');
    await Promise.resolve();
  });
  expect(read().selected?.agentId).toBe('a');
});
