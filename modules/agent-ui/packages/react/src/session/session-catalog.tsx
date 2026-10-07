import type { SessionLifecycleStatus, SessionSummary } from '@ta-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { Alert, Badge, EmptyState, Spinner } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

export type SessionCatalogState =
  | Readonly<{ error: ReactNode; status: 'failed' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{
      hasMore: boolean;
      loadMoreError?: ReactNode;
      loadingMore?: boolean;
      sessions: readonly SessionSummary[];
      status: 'ready';
    }>;

export type SessionStatusLabels = Readonly<Record<SessionLifecycleStatus, ReactNode>>;

type NativeSessionCatalogProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface SessionCatalogProps extends NativeSessionCatalogProps {
  readonly emptyDescription?: ReactNode;
  readonly emptyTitle: ReactNode;
  readonly disabledSessionIds?: readonly string[];
  readonly formatMetadata: (session: SessionSummary) => ReactNode;
  readonly loadMoreLabel: ReactNode;
  readonly loadingLabel: string;
  readonly newSessionAction?: ReactNode;
  readonly onLoadMore?: () => void;
  readonly onRetry?: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly retryLabel?: ReactNode;
  readonly selectedSessionId?: string;
  readonly state: SessionCatalogState;
  readonly statusLabels: SessionStatusLabels;
  readonly style?: never;
  readonly untitledLabel: ReactNode;
  readonly workingSessionIds?: readonly string[];
  readonly workingLabel: string;
}

export function SessionCatalog({
  className,
  disabledSessionIds = [],
  emptyDescription,
  emptyTitle,
  formatMetadata,
  loadMoreLabel,
  loadingLabel,
  newSessionAction,
  onLoadMore,
  onRetry,
  onSelectSession,
  retryLabel,
  selectedSessionId,
  state,
  statusLabels,
  untitledLabel,
  workingLabel,
  workingSessionIds = [],
  ...props
}: SessionCatalogProps) {
  let content: ReactNode;
  if (state.status === 'loading') {
    content = (
      <div className="ta-ui-session-catalog__loading" data-slot="session-catalog-loading">
        <Spinner announcement="polite" label={loadingLabel} />
        <span>{loadingLabel}</span>
      </div>
    );
  } else if (state.status === 'failed') {
    content = (
      <Alert announcement="assertive" className="ta-ui-session-catalog__error" tone="critical">
        <span>{state.error}</span>
        {onRetry !== undefined && retryLabel !== undefined && (
          <Button appearance="outline" onClick={onRetry} size="small" tone="neutral">
            {retryLabel}
          </Button>
        )}
      </Alert>
    );
  } else if (state.sessions.length === 0) {
    content = (
      <EmptyState actions={newSessionAction} description={emptyDescription} title={emptyTitle} />
    );
  } else {
    content = (
      <>
        <SessionList
          disabledSessionIds={disabledSessionIds}
          formatMetadata={formatMetadata}
          onSelectSession={onSelectSession}
          sessions={state.sessions}
          statusLabels={statusLabels}
          untitledLabel={untitledLabel}
          workingLabel={workingLabel}
          {...(selectedSessionId === undefined ? {} : { selectedSessionId })}
          workingSessionIds={workingSessionIds}
        />
        {state.loadMoreError !== undefined && (
          <Alert announcement="assertive" tone="critical">
            {state.loadMoreError}
          </Alert>
        )}
        {state.hasMore && onLoadMore !== undefined && (
          <Button
            appearance="outline"
            onClick={onLoadMore}
            pending={state.loadingMore ?? false}
            tone="neutral"
          >
            {loadMoreLabel}
          </Button>
        )}
      </>
    );
  }

  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-session-catalog', className)}
      data-slot="session-catalog"
      data-state={state.status}
    >
      {content}
      {state.status === 'ready' && state.sessions.length > 0 ? newSessionAction : null}
    </div>
  );
}

type NativeSessionListProps = Omit<ComponentPropsWithRef<'ul'>, 'children' | 'style'>;

export interface SessionListProps extends NativeSessionListProps {
  readonly disabledSessionIds?: readonly string[];
  readonly formatMetadata: (session: SessionSummary) => ReactNode;
  readonly onSelectSession: (sessionId: string) => void;
  readonly selectedSessionId?: string;
  readonly sessions: readonly SessionSummary[];
  readonly statusLabels: SessionStatusLabels;
  readonly style?: never;
  readonly untitledLabel: ReactNode;
  readonly workingSessionIds?: readonly string[];
  readonly workingLabel: string;
}

export function SessionList({
  className,
  disabledSessionIds = [],
  formatMetadata,
  onSelectSession,
  selectedSessionId,
  sessions,
  statusLabels,
  untitledLabel,
  workingLabel,
  workingSessionIds = [],
  ...props
}: SessionListProps) {
  return (
    <ul
      {...props}
      className={joinStyleHooks('ta-ui-session-list', className)}
      data-slot="session-list"
    >
      {sessions.map((session) => (
        <SessionListItem
          key={session.sessionId}
          disabled={disabledSessionIds.includes(session.sessionId)}
          metadata={formatMetadata(session)}
          onSelect={() => onSelectSession(session.sessionId)}
          selected={selectedSessionId === session.sessionId}
          session={session}
          statusLabel={statusLabels[session.status]}
          title={session.title ?? untitledLabel}
          working={workingSessionIds.includes(session.sessionId)}
          workingLabel={workingLabel}
        />
      ))}
    </ul>
  );
}

type NativeSessionListItemProps = Omit<ComponentPropsWithRef<'li'>, 'children' | 'style' | 'title'>;

export interface SessionListItemProps extends NativeSessionListItemProps {
  readonly disabled?: boolean;
  readonly metadata: ReactNode;
  readonly onSelect: () => void;
  readonly selected?: boolean;
  readonly session: SessionSummary;
  readonly statusLabel: ReactNode;
  readonly style?: never;
  readonly title: ReactNode;
  readonly working?: boolean;
  readonly workingLabel: ReactNode;
}

export function SessionListItem({
  className,
  disabled = false,
  metadata,
  onSelect,
  selected = false,
  session,
  statusLabel,
  title,
  working = false,
  workingLabel,
  ...props
}: SessionListItemProps) {
  return (
    <li
      {...props}
      className={joinStyleHooks('ta-ui-session-list__item', className)}
      data-selected={selected || undefined}
      data-slot="session-list-item"
      data-status={session.status}
      data-working={working || undefined}
    >
      <button
        aria-busy={working || undefined}
        aria-current={selected ? 'true' : undefined}
        className="ta-ui-session-list__button"
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        <span className="ta-ui-session-list__content">
          <span className="ta-ui-session-list__title">{title}</span>
          <span className="ta-ui-session-list__metadata">{metadata}</span>
        </span>
        {working ? (
          <span className="ta-ui-session-list__working">
            <Spinner decorative />
            <span>{workingLabel}</span>
          </span>
        ) : (
          <SessionStatusBadge label={statusLabel} status={session.status} />
        )}
      </button>
    </li>
  );
}

export interface SessionStatusBadgeProps {
  readonly label: ReactNode;
  readonly status: SessionLifecycleStatus;
}

export function SessionStatusBadge({ label, status }: SessionStatusBadgeProps) {
  return (
    <Badge data-session-status={status} tone={status === 'active' ? 'positive' : 'neutral'}>
      {label}
    </Badge>
  );
}
