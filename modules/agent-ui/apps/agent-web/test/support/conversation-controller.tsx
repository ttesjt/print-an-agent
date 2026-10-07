import type {
  CompletedConversationTurn,
  ConversationInteractionEventConsumer,
  StartConversationInteractionInput,
} from '@ta-agent/ui-contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { ConversationManagementPort } from '../../src/application/ports.js';
import { ConversationWorkspace } from '../../src/conversation/conversation-workspace.js';
import {
  useConversationManagement,
  type ConversationManagementController,
} from '../../src/conversation/use-conversation-management.js';
import type { SessionSelectionState } from '../../src/session/use-session-management.js';

type ControllerInput = Parameters<typeof useConversationManagement>[0];

const mountedRoots = new Set<Root>();
const TIMESTAMP = '2026-02-01T00:00:00.000Z';

export function readySession(agentId = 'agent-a'): SessionSelectionState {
  return {
    details: {
      agentId,
      branchCount: 1,
      createdAt: TIMESTAMP,
      metadataRevision: 'metadata-1',
      navigationRevision: 'navigation-1',
      selectedBranchId: 'main',
      sessionId: 'shared-session',
      status: 'active',
      turnCount: 1,
      updatedAt: TIMESTAMP,
    },
    navigation: {
      agentId,
      branches: [{ branchId: 'main', createdAt: TIMESTAMP }],
      revision: 'navigation-1',
      selectedBranchId: 'main',
      sessionId: 'shared-session',
    },
    status: 'ready',
  };
}

export function completedTurn(
  turnId: string,
  text = 'New answer',
  userText = 'Question'
): CompletedConversationTurn {
  return {
    assistantMessage: { reasoningBlocks: [], text, timestamp: TIMESTAMP, toolActivities: [] },
    branchId: 'main',
    status: 'completed',
    turnId,
    userMessage: { text: userText, timestamp: TIMESTAMP },
  };
}

export async function completeInteraction(
  input: StartConversationInteractionInput,
  consume: ConversationInteractionEventConsumer
): Promise<void> {
  await consume({ interactionId: input.interactionId, type: 'interaction-started' });
  await consume({
    delta: 'New answer',
    interactionId: input.interactionId,
    modelTurnIndex: 1,
    type: 'text-delta',
  });
  await consume({
    interactionId: input.interactionId,
    sessionId: 'shared-session',
    turn: completedTurn(`turn-${input.interactionId}`, 'New answer', input.message),
    type: 'completed',
  });
}

export function conversationPorts(
  overrides: Partial<ConversationManagementPort> = {}
): ConversationManagementPort {
  return {
    forkSessionBranch: () =>
      Promise.resolve({
        failure: { code: 'unavailable', message: 'Branch mutation is unavailable.' },
        status: 'failed',
      }),
    readConversation: () =>
      Promise.resolve({
        status: 'succeeded',
        value: { turns: [completedTurn('initial', 'Old answer')] },
      }),
    rewindSessionBranch: () =>
      Promise.resolve({
        failure: { code: 'unavailable', message: 'Branch mutation is unavailable.' },
        status: 'failed',
      }),
    streamInteraction: completeInteraction,
    ...overrides,
  };
}

export function mountConversationController(initial: ControllerInput) {
  let controller: ConversationManagementController | undefined;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.add(root);

  function Harness({ input }: Readonly<{ input: ControllerInput }>) {
    controller = useConversationManagement(input);
    return (
      <ConversationWorkspace
        controller={controller}
        sessionState={input.sessionState}
        interactionAllowed
      />
    );
  }

  const render = (input: ControllerInput) => act(() => root.render(<Harness input={input} />));
  render(initial);
  return {
    container,
    get controller(): ConversationManagementController {
      if (controller === undefined) throw new Error('Conversation controller has not rendered.');
      return controller;
    },
    render,
  };
}

export function cleanupConversationControllers(): void {
  for (const root of mountedRoots) act(() => root.unmount());
  mountedRoots.clear();
  document.body.replaceChildren();
}

export async function flushConversation(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
