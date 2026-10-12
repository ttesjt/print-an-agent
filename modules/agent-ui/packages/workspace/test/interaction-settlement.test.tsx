import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ConversationInteractionEventConsumer,
  StartConversationInteractionInput,
  WorkspaceConversationPort,
} from '@ta-agent/ui-contracts';
import { useConversationManagement, type SessionSelectionState } from '../src/testing.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});

function streams() {
  const runs: {
    input: StartConversationInteractionInput;
    consume: ConversationInteractionEventConsumer;
    done: ReturnType<typeof Promise.withResolvers<void>>;
  }[] = [];
  const port: WorkspaceConversationPort = {
    readConversation: () => Promise.resolve({ status: 'succeeded', value: { turns: [] } }),
    streamInteraction: (input, consume) => {
      const done = Promise.withResolvers<void>();
      runs.push({ input, consume, done });
      return done.promise;
    },
  };
  return { port, runs };
}
type Run = ReturnType<typeof streams>['runs'][number];
async function terminal(run: Run, type: 'failed' | 'cancelled') {
  await act(async () => {
    const interactionId = run.input.interactionId;
    await run.consume({ type: 'interaction-started', interactionId });
    await run.consume(
      type === 'failed'
        ? { type, interactionId, failure: { code: 'interaction-failed', message: 'Failed early' } }
        : { type, interactionId }
    );
  });
}
async function mount(port: WorkspaceConversationPort) {
  let agentId: string | undefined = 'alpha';
  let sessionState: SessionSelectionState = { status: 'draft', draftId: 'first' };
  let controller: ReturnType<typeof useConversationManagement>;
  const settled = vi.fn();
  const committed = vi.fn();
  function Probe() {
    controller = useConversationManagement({
      agentId,
      management: port,
      sessionState,
      onConversationCommitted: committed,
      onInteractionSettled: settled,
      onNavigationChanged: () => {},
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = () => act(() => root?.render(<Probe />));
  render();
  await act(async () => {
    await Promise.resolve();
  });
  return {
    read: () => controller,
    settled,
    committed,
    choose: (nextAgent: string | undefined, draftId = 'first') => {
      agentId = nextAgent;
      sessionState = { status: 'draft', draftId };
      render();
    },
    send: (message: string) => {
      act(() => controller.setComposerValue(message));
      let result!: Promise<void>;
      act(() => {
        result = controller.send();
      });
      return result;
    },
  };
}

it.each(['failed', 'cancelled'] as const)(
  'retains single-flight until a %s stream actually settles, then permits retry',
  async (status) => {
    const source = streams();
    const workspace = await mount(source.port);
    const first = workspace.send('first message');
    const run = source.runs[0]!;
    if (status === 'cancelled') act(() => workspace.read().cancel());
    await terminal(run, status);
    expect(workspace.read().activeInteraction?.status).toBe(status);
    expect(workspace.read().interactionPending).toBe(true);
    expect(workspace.read().collectionWorking).toBe(true);
    expect(workspace.read().workingAgentIds).toEqual(['alpha']);
    await act(() => workspace.send('retry message'));
    expect(source.runs).toHaveLength(1);
    await act(async () => {
      run.done.resolve();
      await first;
    });
    expect(workspace.read().interactionPending).toBe(false);
    expect(workspace.read().collectionWorking).toBe(false);
    expect(workspace.read().composerValue).toBe('retry message');
    let retry!: Promise<void>;
    act(() => {
      retry = workspace.read().send();
    });
    expect(source.runs).toHaveLength(2);
    const next = source.runs[1]!;
    expect(next.input.interactionId).not.toBe(run.input.interactionId);
    await terminal(next, 'failed');
    await act(async () => {
      next.done.reject(new Error('Late transport rejection'));
      await retry;
    });
    expect(workspace.read().interactionPending).toBe(false);
    expect(workspace.settled).toHaveBeenCalledTimes(2);
  }
);

it.each(['failed', 'cancelled'] as const)(
  'removal invalidates every owned target, including a %s stream awaiting cleanup',
  async (status) => {
    const source = streams();
    const workspace = await mount(source.port);
    const first = workspace.send('old failed draft');
    const old = source.runs[0]!;
    await terminal(old, status);
    await act(() => workspace.send('blocked retry'));
    expect(source.runs).toHaveLength(1);
    workspace.choose('alpha', 'second');
    const second = workspace.send('other Alpha target');
    workspace.choose('beta');
    const beta = workspace.send('Beta continues');
    act(() => workspace.read().forgetAgent('alpha'));
    expect(old.input.signal?.aborted).toBe(true);
    expect(source.runs[1]!.input.signal?.aborted).toBe(true);
    expect(source.runs[2]!.input.signal?.aborted).toBe(false);
    expect(workspace.read().workingAgentIds).toEqual(['beta']);

    // Reuse exactly the same target key before the invalidated transport rejects.
    workspace.choose('alpha');
    expect(workspace.read().activeInteraction).toBeUndefined();
    expect(workspace.read().composerValue).toBe('');
    const replacement = workspace.send('new Alpha identity');
    const fresh = source.runs[3]!;
    await act(async () => {
      old.done.reject(new Error('Very late failure'));
      source.runs[1]!.done.resolve();
      await Promise.all([first, second]);
    });
    expect(workspace.read().activeInteraction?.interactionId).toBe(fresh.input.interactionId);
    expect(workspace.read().interactionPending).toBe(true);
    expect(workspace.settled).not.toHaveBeenCalled();
    expect(workspace.committed).not.toHaveBeenCalled();
    expect(workspace.read().collectionWorking).toBe(true);
    await terminal(fresh, 'cancelled');
    await terminal(source.runs[2]!, 'cancelled');
    await act(async () => {
      fresh.done.resolve();
      source.runs[2]!.done.resolve();
      await Promise.all([replacement, beta]);
    });
  }
);
