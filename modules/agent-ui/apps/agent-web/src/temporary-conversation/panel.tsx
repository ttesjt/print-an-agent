import {
  Alert,
  Button,
  Cluster,
  ConversationComposer,
  ConversationScrollRegion,
  ConversationTimeline,
  ConversationTurn,
  Drawer,
  Stack,
  type ConversationTurnLabels,
} from '@ta-agent/ui-react';
import { useEffect, useState } from 'react';
import type { TemporaryConversationController, TemporaryConversationState } from './controller.js';

const labels: ConversationTurnLabels = {
  assistant: 'Assistant',
  user: 'You',
  reasoning: () => 'Thinking',
  reasoningStates: { streaming: null, completed: null, incomplete: 'Incomplete' },
  states: {
    submitting: 'Preparing…',
    streaming: 'Responding…',
    cancelling: 'Cancelling…',
    completed: 'Completed',
    committed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },
  toolDetails: 'Details',
  tools: { pending: 'Working', success: 'Completed', error: 'Failed', interrupted: 'Interrupted' },
};
export function TemporaryConversationPanel({
  controller,
  state,
  loading,
  onClear,
  error,
  allowed,
}: {
  readonly controller: TemporaryConversationController;
  readonly state: TemporaryConversationState;
  readonly loading: boolean;
  readonly onClear: () => void;
  readonly error: string | undefined;
  readonly allowed: boolean;
}) {
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>({});
  useEffect(() => {
    setExpanded({});
  }, [state.generation]);
  return (
    <Drawer
      open={state.open}
      onOpenChange={(open) => {
        if (!open) controller.close();
      }}
      title={`Temporary conversation${state.target === undefined ? '' : ` · ${state.target.displayName}`}`}
      className="ta-ui-conversation-drawer"
      footer={
        state.open ? (
          <Cluster>
            <Button appearance="outline" onClick={onClear} disabled={loading}>
              Clear conversation
            </Button>
            <Button appearance="outline" onClick={() => controller.close()}>
              Close temporary conversation
            </Button>
          </Cluster>
        ) : undefined
      }
    >
      {state.open && (
        <Stack space="medium">
          <p>
            Kept only in this page's memory. Not saved to Sessions; refreshing discards it. Uses
            published Agent settings. Closing this panel does not stop an active response.
          </p>
          {state.notice !== undefined && <Alert tone="caution">{state.notice}</Alert>}
          {error !== undefined && <Alert tone="critical">{error}</Alert>}
          {!allowed && (
            <Alert tone="caution">
              Configure an available model and active Agent to send. This temporary history can
              still be viewed or cleared.
            </Alert>
          )}
          <ConversationScrollRegion
            aria-label="Temporary transcript"
            conversationKey={`temporary:${state.generation}`}
            contentRevision={`${state.turns.length}:${state.turns.at(-1)?.text.length ?? 0}:${state.turns.at(-1)?.reasoning[0]?.text.length ?? 0}`}
            jumpToLatestLabel="Jump to latest"
          >
            <ConversationTimeline
              emptyTitle="Start a temporary conversation"
              emptyDescription="Its history stays in this page only."
              loadMoreLabel="More"
              loadingLabel="Loading"
              retryLabel="Retry"
            >
              {state.turns.map((turn) => (
                <ConversationTurn
                  key={turn.id}
                  userMessage={turn.user}
                  assistantText={turn.text}
                  reasoningBlocks={turn.reasoning}
                  state={turn.status}
                  failure={turn.failure}
                  labels={labels}
                  reasoningDisclosure={() => ({
                    open: expanded[turn.id] ?? false,
                    onOpenChange: (open) =>
                      setExpanded((previous) => ({ ...previous, [turn.id]: open })),
                  })}
                />
              ))}
            </ConversationTimeline>
          </ConversationScrollRegion>
          <ConversationComposer
            inputLabel="Temporary message"
            value={state.draft}
            onValueChange={(value) => controller.setDraft(value)}
            onSubmit={() => {
              void controller.send();
            }}
            onCancel={() => controller.cancel()}
            sendLabel="Send temporary message"
            cancelLabel="Cancel response"
            state={
              state.busy
                ? state.turns.at(-1)?.status === 'cancelling'
                  ? 'cancelling'
                  : 'streaming'
                : loading || state.blocked || error !== undefined || !allowed
                  ? 'disabled'
                  : 'idle'
            }
          />
        </Stack>
      )}
    </Drawer>
  );
}
