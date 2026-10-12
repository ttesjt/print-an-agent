import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type {
  CompletedConversationTurn,
  ConversationSessionAdmission,
  WorkspaceConversationPort,
} from '@ta-agent/ui-contracts';
import {
  ConversationWorkspace,
  useConversationManagement,
  executeConversationInteraction,
  createSubmittingInteraction,
  historyTurns,
} from '../src/testing.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
const admission: ConversationSessionAdmission = {
  details: {
    agentId: 'a',
    sessionId: 's',
    selectedBranchId: 'b',
    metadataRevision: '1',
    navigationRevision: '1',
    branchCount: 1,
    turnCount: 1,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  navigation: {
    agentId: 'a',
    sessionId: 's',
    revision: '1',
    selectedBranchId: 'b',
    branches: [{ branchId: 'b', createdAt: '2026-01-01T00:00:00Z' }],
  },
};
const completed: CompletedConversationTurn = {
  turnId: 't',
  branchId: 'b',
  status: 'completed',
  userMessage: { text: 'hello', timestamp: '2026-01-01T00:00:00Z' },
  assistantMessage: {
    text: 'answer',
    timestamp: '2026-01-01T00:00:01Z',
    reasoningBlocks: [],
    toolActivities: [],
  },
};
function stream(late = false): WorkspaceConversationPort['streamInteraction'] {
  return async (input, consume) => {
    await consume({ type: 'interaction-started', interactionId: input.interactionId });
    await consume({ type: 'session-admitted', interactionId: input.interactionId, admission });
    await consume({
      type: 'text-delta',
      interactionId: input.interactionId,
      delta: 'answer',
      modelTurnIndex: 1,
    });
    await consume({
      type: 'committed',
      interactionId: input.interactionId,
      receipt: { sessionId: 's', branchId: 'b', turnId: 't' },
      message: 'Saved; presentation temporarily unavailable.',
    });
    if (late)
      await consume({
        type: 'text-delta',
        interactionId: input.interactionId,
        delta: 'invalid late output',
        modelTurnIndex: 1,
      });
  };
}
it('settles execution despite failed history, preserves partial output and recovers by exact Turn identity', async () => {
  let readable = false;
  let calls = 0;
  let controller: ReturnType<typeof useConversationManagement> | undefined;
  const management: WorkspaceConversationPort = {
    streamInteraction: async (i, c) => {
      calls++;
      await stream()(i, c);
    },
    readConversation: () =>
      Promise.resolve(
        readable
          ? { status: 'succeeded', value: { turns: [completed] } }
          : { status: 'failed', failure: { code: 'unavailable', message: 'History unavailable' } }
      ),
  };
  const sessionState = { status: 'ready', ...admission } as const;
  const noOp = () => {};
  function Probe() {
    const c = useConversationManagement({
      agentId: 'a',
      management,
      sessionState,
      onConversationCommitted: noOp,
      onInteractionSettled: noOp,
      onNavigationChanged: noOp,
    });
    controller = c;
    return <ConversationWorkspace controller={c} sessionState={sessionState} interactionAllowed />;
  }
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe />);
    await Promise.resolve();
  });
  act(() => controller?.setComposerValue('hello'));
  await act(() => controller?.send());
  expect(controller?.collectionWorking).toBe(false);
  expect(container.textContent).toContain('answer');
  expect(container.textContent).toContain('Saved; presentation temporarily unavailable');
  expect(container.textContent).not.toContain('Responding');
  expect(container.textContent).not.toContain('Fork from here');
  const interactionId = controller?.activeInteraction?.interactionId;
  if (interactionId === undefined) throw new Error('Missing saved interaction');
  act(() =>
    controller
      ?.reasoningDisclosure({ kind: 'interaction', id: interactionId }, 1)
      .onOpenChange(true)
  );
  readable = true;
  await act(async () => {
    controller?.refreshHistory();
    await Promise.resolve();
  });
  expect(controller?.activeInteraction).toBeUndefined();
  expect(controller?.reasoningDisclosure({ kind: 'turn', id: 't' }, 1).open).toBe(true);
  expect(historyTurns(controller?.historyState ?? { status: 'idle' })).toEqual([completed]);
  expect(calls).toBe(1);
});
it('does not publish a receipt from a stream with trailing invalid events', async () => {
  let published = false;
  const state = await executeConversationInteraction({
    initial: createSubmittingInteraction({
      interactionId: 'i',
      message: 'hello',
      timestamp: '2026-01-01T00:00:00Z',
    }),
    management: {
      streamInteraction: stream(true),
      readConversation: () => Promise.resolve({ status: 'succeeded', value: { turns: [] } }),
    },
    isCurrent: () => true,
    onAdmission: () => {},
    onProgress: (state) => {
      if (state.status === 'committed') published = true;
    },
    request: { agentId: 'a', interactionId: 'i', message: 'hello' },
  });
  expect(state?.status).toBe('failed');
  expect(published).toBe(false);
});

it.each([
  {
    name: 'matching requested target',
    requested: true,
    sessionId: 's',
    branchId: 'b',
    turnId: 't',
    status: 'committed',
  },
  {
    name: 'no requested or admitted target',
    requested: false,
    sessionId: 's',
    branchId: 'b',
    turnId: 't',
    status: 'failed',
  },
  {
    name: 'different Session',
    requested: true,
    sessionId: 'other',
    branchId: 'b',
    turnId: 't',
    status: 'failed',
  },
  {
    name: 'different branch',
    requested: true,
    sessionId: 's',
    branchId: 'other',
    turnId: 't',
    status: 'failed',
  },
  {
    name: 'missing Turn identity',
    requested: true,
    sessionId: 's',
    branchId: 'b',
    turnId: '',
    status: 'failed',
  },
] as const)(
  'validates replay receipts against the request: $name',
  async ({ requested, sessionId, branchId, turnId, status }) => {
    const session = { sessionId: 's', branchId: 'b', navigationRevision: '1' };
    const state = await executeConversationInteraction({
      // Initial display state cannot smuggle in authority absent from the actual request.
      initial: createSubmittingInteraction({
        interactionId: 'i',
        message: 'hello',
        timestamp: '2026-01-01T00:00:00Z',
        session,
      }),
      request: {
        agentId: 'a',
        interactionId: 'i',
        message: 'hello',
        ...(requested ? { session } : {}),
      },
      management: {
        readConversation: () => Promise.resolve({ status: 'succeeded', value: { turns: [] } }),
        streamInteraction: async (input, consume) => {
          await consume({ type: 'interaction-started', interactionId: input.interactionId });
          await consume({
            type: 'committed',
            interactionId: input.interactionId,
            receipt: { sessionId, branchId, turnId },
            message: 'Reload saved response.',
          });
        },
      },
      isCurrent: () => true,
      onAdmission: () => {},
      onProgress: () => {},
    });
    expect(state?.status).toBe(status);
    if (status === 'failed') expect(state).toMatchObject({ failure: { code: 'invalid-stream' } });
  }
);
