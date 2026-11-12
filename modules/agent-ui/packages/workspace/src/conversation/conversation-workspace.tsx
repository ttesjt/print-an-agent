import type {
  CompletedConversationTurn,
  ConversationTurn as TurnValue,
} from '@print-an-agent/ui-contracts';
import {
  Alert,
  Button,
  ConfirmationDialog,
  ConversationComposer,
  ConversationScrollRegion,
  ConversationTimeline,
  ConversationTurn,
  Stack,
  Status,
  type ConversationComposerState,
  type ConversationTurnLabels,
  type ConversationTurnProps,
} from '@print-an-agent/ui-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { SessionSelectionState } from '../session/use-session-management.js';
import { historyTurns } from './conversation-history-state.js';
import { interactionAssistantText, interactionReasoningBlocks } from './interaction-state.js';
import type { ConversationManagementController } from './use-conversation-management.js';
import { CompletedTurnActions } from './completed-turn-actions.js';

const TURN_LABELS = Object.freeze<ConversationTurnLabels>({
  assistant: 'Assistant',
  reasoning: (modelTurnIndex, { blockCount }) =>
    blockCount === 1 ? 'Thought process' : `Thought process · stage ${String(modelTurnIndex)}`,
  reasoningStates: Object.freeze({
    completed: null,
    incomplete: 'Incomplete',
    streaming: 'Live',
  }),
  states: Object.freeze({
    cancelled: 'Cancelled',
    cancelling: 'Cancelling',
    completed: 'Completed',
    committed: 'Saved · presentation needs recovery',
    failed: 'Failed',
    streaming: 'Responding',
    submitting: 'Starting',
  }),
  toolDetails: null,
  tools: Object.freeze({
    error: 'Failed',
    interrupted: 'Interrupted',
    pending: 'Running',
    success: 'Done',
  }),
  user: 'You',
});

type ReasoningDisclosure = NonNullable<ConversationTurnProps['reasoningDisclosure']>;

export function ConversationWorkspace({
  controller,
  sessionState,
  interactionAllowed,
  focusRequest = 0,
}: Readonly<{
  controller: ConversationManagementController;
  sessionState: SessionSelectionState;
  interactionAllowed: boolean;
  focusRequest?: number;
}>) {
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (interactionAllowed && focusRequest > 0) composer.current?.focus();
  }, [focusRequest, interactionAllowed]);
  const [rewindTurnId, setRewindTurnId] = useState<string>();
  const history = controller.historyState;
  const active = controller.activeInteraction;
  const turns = historyTurns(history);
  const conversationEnabled =
    interactionAllowed &&
    (sessionState.status === 'draft' ||
      (sessionState.status === 'ready' && sessionState.details.status === 'active'));
  const running = controller.interactionPending;
  // Readiness governs new work, not the ability to cancel an already-owned interaction.
  const composerState: ConversationComposerState =
    active?.status === 'cancelling'
      ? 'cancelling'
      : active?.status === 'streaming'
        ? 'streaming'
        : active?.status === 'submitting'
          ? 'submitting'
          : !conversationEnabled || running
            ? 'disabled'
            : 'idle';
  const conversationKey =
    sessionState.status === 'ready'
      ? `${sessionState.details.sessionId}:${sessionState.navigation.selectedBranchId}`
      : 'draft';
  const contentRevision = [
    conversationKey,
    turns.length,
    active?.interactionId ?? 'none',
    active?.status ?? 'none',
    active === undefined ? 0 : interactionAssistantText(active).length,
    active === undefined
      ? 0
      : interactionReasoningBlocks(active).reduce((sum, block) => sum + block.text.length, 0),
    active === undefined
      ? 'none'
      : active.toolActivities.map((activity) => `${activity.callId}:${activity.status}`).join(','),
    active?.status === 'failed' ? active.failure.message.length : 0,
  ].join(':');

  return (
    <Stack space="medium" className="ta-ui-workspace-conversation">
      <ConversationScrollRegion
        aria-label="Conversation"
        contentRevision={contentRevision}
        conversationKey={conversationKey}
        jumpToLatestLabel="Jump to latest"
      >
        <ConversationTimeline
          emptyDescription="Send a message to begin this conversation."
          emptyTitle="No turns yet"
          error={history.status === 'failed' ? history.error : undefined}
          hasMore={history.status === 'ready' && history.hasMore}
          loadMoreLabel="Load older turns"
          loading={history.status === 'loading'}
          loadingLabel="Loading conversation…"
          onLoadMore={() => void controller.loadMore()}
          onRetry={controller.refreshHistory}
          retryLabel="Retry"
          {...(history.status === 'ready' && history.loadingMore !== undefined
            ? { loadingMore: history.loadingMore }
            : {})}
        >
          {turns.map((turn) => (
            <PersistedTurn
              {...(turn.status === 'completed'
                ? {
                    actions: (
                      <CompletedTurnActions
                        disabled={running || controller.branchMutationTurnId !== undefined}
                        forkPending={controller.branchMutationTurnId === turn.turnId}
                        {...(sessionState.status === 'ready' && conversationEnabled
                          ? {
                              ...(controller.capabilities.fork
                                ? { onFork: () => void controller.forkFromTurn(turn.turnId) }
                                : {}),
                              ...(controller.capabilities.rewind
                                ? { onRewind: () => setRewindTurnId(turn.turnId) }
                                : {}),
                            }
                          : {})}
                        turn={turn}
                      />
                    ),
                  }
                : {})}
              key={turn.turnId}
              reasoningDisclosure={(block) =>
                controller.reasoningDisclosure(
                  { id: turn.turnId, kind: 'turn' },
                  block.modelTurnIndex
                )
              }
              turn={turn}
            />
          ))}
          {active === undefined ? null : (
            <ConversationTurn
              assistantText={interactionAssistantText(active)}
              actions={
                active.status === 'committed' ? (
                  <Alert tone="caution">
                    {active.message}
                    <Button onClick={controller.refreshHistory}>Reload saved response</Button>
                  </Alert>
                ) : undefined
              }
              failure={active.status === 'failed' ? active.failure.message : undefined}
              key={active.interactionId}
              labels={TURN_LABELS}
              reasoningBlocks={interactionReasoningBlocks(active)}
              reasoningDisclosure={(block) =>
                controller.reasoningDisclosure(
                  { id: active.interactionId, kind: 'interaction' },
                  block.modelTurnIndex
                )
              }
              reasoningMaxContentHeight="medium"
              state={active.status}
              toolActivities={active.toolActivities}
              userMessage={active.userMessage}
            />
          )}
        </ConversationTimeline>
      </ConversationScrollRegion>

      {history.status === 'ready' && history.loadMoreError !== undefined ? (
        <Alert announcement="assertive" tone="critical">
          {history.loadMoreError}
        </Alert>
      ) : null}
      {controller.branchMutationError === undefined ? null : (
        <Alert announcement="assertive" tone="caution">
          <span>{controller.branchMutationError}</span>
          <Button
            appearance="outline"
            onClick={controller.reconcileNavigation}
            size="small"
            tone="neutral"
          >
            Reload Session and conversation
          </Button>
        </Alert>
      )}

      {!interactionAllowed && !running ? (
        <Status>This Agent is not ready for a new response.</Status>
      ) : null}
      <ConversationComposer
        inputRef={composer}
        cancelLabel="Cancel response"
        inputLabel="Message"
        onCancel={controller.cancel}
        onSubmit={() => void controller.send()}
        onValueChange={controller.setComposerValue}
        placeholder="Ask this Agent…"
        sendLabel="Send"
        state={composerState}
        value={controller.composerValue}
      />

      <ConfirmationDialog
        cancelLabel="Cancel"
        confirmLabel="Create rewind branch"
        description="Create and select a new branch ending at this turn. Existing history will remain unchanged."
        onConfirm={() => {
          if (rewindTurnId !== undefined) void controller.rewindToTurn(rewindTurnId);
          setRewindTurnId(undefined);
        }}
        onOpenChange={(open) => !open && setRewindTurnId(undefined)}
        open={rewindTurnId !== undefined}
        title="Rewind without deleting history?"
        tone="neutral"
      />
    </Stack>
  );
}

function PersistedTurn({
  actions,
  reasoningDisclosure,
  turn,
}: Readonly<{
  actions?: ReactNode;
  reasoningDisclosure: ReasoningDisclosure;
  turn: TurnValue;
}>) {
  if (turn.status === 'failed') {
    return (
      <ConversationTurn
        failure={turn.failure.message}
        labels={TURN_LABELS}
        state="failed"
        userMessage={turn.userMessage}
      />
    );
  }
  return (
    <CompletedTurn
      {...(actions === undefined ? {} : { actions })}
      reasoningDisclosure={reasoningDisclosure}
      turn={turn}
    />
  );
}

function CompletedTurn({
  actions,
  reasoningDisclosure,
  turn,
}: Readonly<{
  actions?: ReactNode;
  reasoningDisclosure: ReasoningDisclosure;
  turn: CompletedConversationTurn;
}>) {
  return (
    <ConversationTurn
      {...(actions === undefined ? {} : { actions })}
      assistantText={turn.assistantMessage.text}
      labels={TURN_LABELS}
      reasoningBlocks={turn.assistantMessage.reasoningBlocks}
      reasoningDisclosure={reasoningDisclosure}
      reasoningMaxContentHeight="medium"
      state="completed"
      timestamp={turn.assistantMessage.timestamp}
      toolActivities={turn.assistantMessage.toolActivities}
      userMessage={turn.userMessage}
    />
  );
}
