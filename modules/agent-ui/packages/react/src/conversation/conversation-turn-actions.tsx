import type { ComponentPropsWithRef, ReactNode } from 'react';

import { ActionBar } from '../actions/action-bar.js';
import { Button, IconButton } from '../actions/button.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { Tooltip, type TooltipPlacement } from '../overlays/tooltip.js';

export interface ConversationTurnActionsProps extends Omit<
  ComponentPropsWithRef<'div'>,
  'children' | 'role' | 'style'
> {
  readonly 'aria-label': string;
  readonly answeredAt: string;
  readonly answeredLabel: ReactNode;
  readonly disabled?: boolean;
  readonly forkLabel: ReactNode;
  readonly forkPending?: boolean;
  readonly formatTimestamp: (timestamp: string) => ReactNode;
  readonly onFork?: () => void;
  readonly onRewind?: () => void;
  readonly rewindLabel: ReactNode;
  readonly sentAt: string;
  readonly sentLabel: ReactNode;
  readonly style?: never;
  readonly timestampsLabel: string;
  readonly tooltipPlacement?: TooltipPlacement;
}

/** Completed-Turn presentation only. The application owns commit, capabilities, and confirmations. */
export function ConversationTurnActions({
  answeredAt,
  answeredLabel,
  className,
  disabled = false,
  forkLabel,
  forkPending = false,
  formatTimestamp,
  onFork,
  onRewind,
  rewindLabel,
  sentAt,
  sentLabel,
  timestampsLabel,
  tooltipPlacement = 'top',
  ...props
}: ConversationTurnActionsProps) {
  return (
    <ActionBar
      {...props}
      className={joinStyleHooks('ta-ui-conversation-turn-actions', className)}
      data-conversation-turn-actions
    >
      {onFork !== undefined && (
        <Button
          appearance="ghost"
          disabled={disabled}
          onClick={onFork}
          pending={forkPending}
          size="small"
          tone="neutral"
        >
          {forkLabel}
        </Button>
      )}
      {onRewind !== undefined && (
        <Button
          appearance="ghost"
          disabled={disabled || forkPending}
          onClick={onRewind}
          size="small"
          tone="neutral"
        >
          {rewindLabel}
        </Button>
      )}
      <Tooltip
        content={
          <dl className="ta-ui-conversation-turn-actions__timestamps">
            <div>
              <dt>{sentLabel}</dt>
              <dd>
                <time dateTime={sentAt}>{formatTimestamp(sentAt)}</time>
              </dd>
            </div>
            <div>
              <dt>{answeredLabel}</dt>
              <dd>
                <time dateTime={answeredAt}>{formatTimestamp(answeredAt)}</time>
              </dd>
            </div>
          </dl>
        }
        placement={tooltipPlacement}
      >
        {(triggerProps) => (
          <IconButton {...triggerProps} aria-label={timestampsLabel} size="small">
            <svg
              aria-hidden="true"
              className="ta-ui-conversation-turn-actions__time-icon"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </IconButton>
        )}
      </Tooltip>
    </ActionBar>
  );
}
