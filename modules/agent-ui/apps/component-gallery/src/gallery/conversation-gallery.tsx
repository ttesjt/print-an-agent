import {
  Button,
  ConversationComposer,
  ConversationScrollRegion,
  ConversationTimeline,
  ConversationTurn,
  Grid,
  Stack,
  type ConversationTurnLabels,
} from '@ta-agent/ui-react';

import { GallerySection } from './gallery-section.js';

const LABELS: ConversationTurnLabels = Object.freeze({
  assistant: 'Assistant',
  reasoning: (index: number) => `Thinking · model turn ${String(index)}`,
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

const USER_MESSAGE = Object.freeze({
  text: 'Compare the available evidence with the local index.',
  timestamp: '2026-02-01T00:00:00.000Z',
});
const REASONING = Object.freeze([
  Object.freeze({ modelTurnIndex: 1, text: 'I will inspect the local index first.' }),
  Object.freeze({ modelTurnIndex: 2, text: 'The returned records agree.' }),
]);
const TOOL_ACTIVITIES = Object.freeze([
  Object.freeze({
    callId: 'gallery-tool-1',
    details: Object.freeze([
      Object.freeze({ label: 'Source', value: 'Sanitized local fixture' }),
      Object.freeze({ label: 'Matches', value: '2' }),
    ]),
    modelTurnIndex: 1,
    status: 'success' as const,
    summary: 'Two records were returned.',
    toolLabel: 'Evidence lookup',
  }),
]);

export function ConversationGallery() {
  return (
    <GallerySection
      description="History, live response, reasoning, safe tool presentation, and composer states."
      id="conversation"
      title="Conversation"
    >
      <Stack space="large">
        <ConversationScrollRegion
          aria-label="Conversation component preview"
          contentRevision="gallery"
          conversationKey="gallery-conversation"
          jumpToLatestLabel="Jump to latest"
        >
          <ConversationTimeline
            emptyTitle="No turns"
            hasMore
            loadMoreLabel="Load older turns"
            loadingLabel="Loading conversation"
            onLoadMore={() => undefined}
            retryLabel="Retry"
          >
            <ConversationTurn
              actions={
                <Button appearance="outline" size="small" tone="neutral">
                  Fork from here
                </Button>
              }
              assistantText="The two strongest records agree on the central result."
              labels={LABELS}
              reasoningBlocks={REASONING}
              state="completed"
              toolActivities={TOOL_ACTIVITIES}
              userMessage={USER_MESSAGE}
            />
            <ConversationTurn
              assistantText="A partial answer"
              labels={LABELS}
              reasoningBlocks={[REASONING[0]!]}
              state="streaming"
              toolActivities={[
                Object.freeze({
                  callId: 'gallery-tool-2',
                  details: Object.freeze([]),
                  modelTurnIndex: 1,
                  status: 'pending',
                  toolLabel: 'Source check',
                }),
              ]}
              userMessage={USER_MESSAGE}
            />
            <ConversationTurn
              assistantText="A partial response that did not complete."
              failure="The interaction failed. Partial output is not a completed turn."
              labels={LABELS}
              reasoningBlocks={[REASONING[0]!]}
              state="failed"
              toolActivities={[
                Object.freeze({
                  callId: 'gallery-tool-3',
                  details: Object.freeze([]),
                  modelTurnIndex: 1,
                  status: 'pending',
                  toolLabel: 'Interrupted source check',
                }),
              ]}
              userMessage={USER_MESSAGE}
            />
          </ConversationTimeline>
        </ConversationScrollRegion>

        <Grid columns="two" space="medium">
          <ConversationComposer
            cancelLabel="Cancel"
            inputLabel="Idle composer"
            onSubmit={() => undefined}
            onValueChange={() => undefined}
            placeholder="Ask this Agent…"
            sendLabel="Send"
            value=""
          />
          <ConversationComposer
            cancelLabel="Cancel response"
            inputLabel="Streaming composer"
            onCancel={() => undefined}
            onSubmit={() => undefined}
            onValueChange={() => undefined}
            sendLabel="Send"
            state="streaming"
            value="Question in progress"
          />
        </Grid>
      </Stack>
    </GallerySection>
  );
}
