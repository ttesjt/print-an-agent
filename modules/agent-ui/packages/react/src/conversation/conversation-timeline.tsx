import { Children, type ComponentPropsWithRef, type ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { Alert, EmptyState, Status } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

type NativeConversationTimelineProps = Omit<ComponentPropsWithRef<'section'>, 'children' | 'style'>;

export interface ConversationTimelineProps extends NativeConversationTimelineProps {
  readonly children?: ReactNode;
  readonly emptyDescription?: ReactNode;
  readonly emptyTitle: ReactNode;
  readonly error?: ReactNode;
  readonly hasMore?: boolean;
  readonly loadMoreLabel: ReactNode;
  readonly loading?: boolean;
  readonly loadingLabel: ReactNode;
  readonly loadingMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly onRetry?: () => void;
  readonly retryLabel: ReactNode;
  readonly style?: never;
}

export function ConversationTimeline({
  children,
  className,
  emptyDescription,
  emptyTitle,
  error,
  hasMore = false,
  loadMoreLabel,
  loading = false,
  loadingLabel,
  loadingMore = false,
  onLoadMore,
  onRetry,
  retryLabel,
  ...props
}: ConversationTimelineProps) {
  const hasTurns = Children.toArray(children).length > 0;

  return (
    <section
      {...props}
      className={joinStyleHooks('ta-ui-conversation-timeline', className)}
      data-slot="conversation-timeline"
    >
      {loading ? <Status announcement="polite">{loadingLabel}</Status> : null}
      {!loading && error !== undefined ? (
        <Alert announcement="assertive" tone="critical">
          <span>{error}</span>
          {onRetry === undefined ? null : (
            <Button appearance="outline" onClick={onRetry} size="small" tone="neutral">
              {retryLabel}
            </Button>
          )}
        </Alert>
      ) : null}
      {!loading && error === undefined && !hasTurns ? (
        <EmptyState description={emptyDescription} title={emptyTitle} />
      ) : null}
      {hasTurns ? (
        <>
          {!loading && error === undefined && hasMore && onLoadMore !== undefined ? (
            <div className="ta-ui-conversation-timeline__load-more">
              <Button
                appearance="outline"
                onClick={onLoadMore}
                pending={loadingMore}
                size="small"
                tone="neutral"
              >
                {loadMoreLabel}
              </Button>
            </div>
          ) : null}
          <ol className="ta-ui-conversation-timeline__list">{children}</ol>
        </>
      ) : null}
    </section>
  );
}
