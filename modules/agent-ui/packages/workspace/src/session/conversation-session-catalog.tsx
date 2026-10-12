import { Alert, Button, EmptyState, SessionListItem, Spinner, Stack } from '@ta-agent/ui-react';

import type { ConversationManagementController } from '../conversation/use-conversation-management.js';
import type { SessionManagementController } from './use-session-management.js';

const STATUS_LABELS = Object.freeze({ active: 'Active', retired: 'Retired' });

/** Optimistic and admitted entries share one list; only confirmed records carry Session identity. */
export function ConversationSessionCatalog({
  agentSelected,
  controller,
  onSelectDraft,
  onSelectSession,
  sessionListKey,
  submittedDrafts,
  workingSessionIds,
}: Readonly<{
  agentSelected: boolean;
  controller: SessionManagementController;
  onSelectDraft: ((draftId: string) => void) | undefined;
  onSelectSession: (sessionId: string) => void;
  sessionListKey: (sessionId: string) => string;
  submittedDrafts: ConversationManagementController['submittedDrafts'];
  workingSessionIds: readonly string[];
}>) {
  const state = controller.catalogState;
  const items = [
    ...submittedDrafts
      .toReversed()
      .map((draft) => (
        <SessionListItem
          data-submitted-conversation={draft.draftId}
          key={draft.listKey}
          metadata={
            draft.status === 'failed'
              ? 'Message failed'
              : draft.status === 'cancelled'
                ? 'Cancelled'
                : null
          }
          onSelect={() => onSelectDraft?.(draft.draftId)}
          selected={
            controller.selectionState.status === 'draft' &&
            controller.selectionState.draftId === draft.draftId
          }
          statusLabel={null}
          title="Untitled Session"
          working={
            draft.status === 'submitting' ||
            draft.status === 'streaming' ||
            draft.status === 'cancelling'
          }
          workingLabel="Working"
        />
      )),
    ...(state.status === 'ready' ? state.sessions : []).map((session) => (
      <SessionListItem
        data-session-id={session.sessionId}
        disabled={controller.workingSessionId === session.sessionId}
        key={sessionListKey(session.sessionId)}
        metadata={`${String(session.turnCount)} turns`}
        onSelect={() => onSelectSession(session.sessionId)}
        selected={controller.selectedSessionId === session.sessionId}
        session={session}
        statusLabel={STATUS_LABELS[session.status]}
        title={session.title ?? 'Untitled Session'}
        working={workingSessionIds.includes(session.sessionId)}
        workingLabel="Working"
      />
    )),
  ];
  return (
    <Stack
      className="ta-ui-session-catalog"
      data-slot="session-catalog"
      data-state={state.status}
      space="small"
    >
      {items.length > 0 && (
        <ul className="ta-ui-session-list" data-slot="session-list">
          {items}
        </ul>
      )}
      {state.status === 'loading' && (
        <div className="ta-ui-session-catalog__loading" data-slot="session-catalog-loading">
          <Spinner announcement="polite" label="Loading Sessions…" />
          <span>Loading Sessions…</span>
        </div>
      )}
      {state.status === 'failed' && (
        <Alert announcement="assertive" tone="critical">
          <span>{state.error}</span>
          <Button
            appearance="outline"
            onClick={controller.refreshCatalog}
            size="small"
            tone="neutral"
          >
            Retry
          </Button>
        </Alert>
      )}
      {state.status === 'ready' && items.length === 0 && (
        <EmptyState
          title={
            agentSelected ? `No ${controller.lifecycleFilter} Sessions.` : 'No Agent selected.'
          }
          description={
            !agentSelected
              ? 'Select an Agent first.'
              : controller.lifecycleFilter === 'active'
                ? 'Start a new conversation to create one.'
                : 'Retired Sessions remain readable until permanently deleted.'
          }
        />
      )}
      {state.status === 'ready' && state.loadMoreError !== undefined && (
        <Alert announcement="assertive" tone="critical">
          {state.loadMoreError}
        </Alert>
      )}
      {state.status === 'ready' && state.hasMore && (
        <Button
          appearance="outline"
          onClick={() => void controller.loadMore()}
          pending={state.loadingMore ?? false}
          tone="neutral"
        >
          Load more Sessions
        </Button>
      )}
    </Stack>
  );
}
