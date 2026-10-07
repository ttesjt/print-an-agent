import type {
  CompletedConversationTurn,
  ConversationTurn as TurnValue,
} from '@ta-agent/ui-contracts';
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
} from '@ta-agent/ui-react';
import { type ReactNode, useState } from 'react';

import type { SessionSelectionState } from '../session/use-session-management.js';
import { historyTurns } from './conversation-history-state.js';
import { interactionAssistantText, interactionReasoningBlocks } from './interaction-state.js';
import type { ConversationManagementController } from './use-conversation-management.js';

const TURN_LABELS: ConversationTurnLabels = Object.freeze({
  assistant: 'Assistant',
  reasoning: (modelTurnIndex: number) => `Thinking · model turn ${String(modelTurnIndex)}`,
  reasoningStates: Object.freeze({
    completed: 'Completed',
    incomplete: 'Incomplete',
    streaming: 'In progress',
  }),
  states: Object.freeze({
    cancelled: 'Cancelled',
    cancelling: 'Cancelling',
    completed: 'Completed',
    failed: 'Failed',
    streaming: 'Responding',
    submitting: 'Starting',
  }),
  toolDetails: 'Details',
  tools: Object.freeze({
    error: 'Failed',
    interrupted: 'Interrupted',
    pending: 'Running',
    success: 'Completed',
  }),
  user: 'You',
});

export function ConversationWorkspace({
  controller,
  sessionState,
  interactionAllowed,
}: Readonly<{
  controller: ConversationManagementController;
  sessionState: SessionSelectionState;
  interactionAllowed: boolean;
}>) {
  const [rewindTurnId, setRewindTurnId] = useState<string>();
  const history = controller.historyState;
  const active = controller.activeInteraction;
  const turns = historyTurns(history);
  const conversationEnabled =
    interactionAllowed &&
    (sessionState.status === 'draft' ||
      (sessionState.status === 'ready' && sessionState.details.status === 'active'));
  const running =
    active?.status === 'cancelling' ||
    active?.status === 'streaming' ||
    active?.status === 'submitting';
  // Readiness governs new work, not the ability to cancel an already-owned interaction.
  const composerState: ConversationComposerState =
    active?.status === 'cancelling'
      ? 'cancelling'
      : active?.status === 'streaming'
        ? 'streaming'
        : active?.status === 'submitting'
          ? 'submitting'
          : !conversationEnabled
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
    <Stack space="medium">
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
              {...(turn.status === 'completed' &&
              sessionState.status === 'ready' &&
              conversationEnabled
                ? {
                    actions: (
                      <>
                        <Button
                          appearance="outline"
                          disabled={running || controller.branchMutationTurnId !== undefined}
                          onClick={() => void controller.forkFromTurn(turn.turnId)}
                          pending={controller.branchMutationTurnId === turn.turnId}
                          size="small"
                          tone="neutral"
                        >
                          Fork from here
                        </Button>
                        <Button
                          appearance="outline"
                          disabled={running || controller.branchMutationTurnId !== undefined}
                          onClick={() => setRewindTurnId(turn.turnId)}
                          size="small"
                          tone="neutral"
                        >
                          Rewind to here
                        </Button>
                      </>
                    ),
                  }
                : {})}
              key={turn.turnId}
              turn={turn}
            />
          ))}
          {active === undefined ? null : (
            <ConversationTurn
              assistantText={interactionAssistantText(active)}
              failure={active.status === 'failed' ? active.failure.message : undefined}
              key={active.interactionId}
              labels={TURN_LABELS}
              reasoningBlocks={interactionReasoningBlocks(active)}
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

function PersistedTurn({ actions, turn }: Readonly<{ actions?: ReactNode; turn: TurnValue }>) {
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
  return <CompletedTurn {...(actions === undefined ? {} : { actions })} turn={turn} />;
}

function CompletedTurn({
  actions,
  turn,
}: Readonly<{ actions?: ReactNode; turn: CompletedConversationTurn }>) {
  return (
    <ConversationTurn
      {...(actions === undefined ? {} : { actions })}
      assistantText={turn.assistantMessage.text}
      formatTimestamp={formatTimestamp}
      labels={TURN_LABELS}
      reasoningBlocks={turn.assistantMessage.reasoningBlocks}
      state="completed"
      timestamp={turn.assistantMessage.timestamp}
      toolActivities={turn.assistantMessage.toolActivities}
      userMessage={turn.userMessage}
    />
  );
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp)
  );
}
