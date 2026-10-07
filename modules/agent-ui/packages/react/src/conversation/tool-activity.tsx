import type {
  ConversationToolActivity as ToolActivityValue,
  ConversationToolActivityStatus,
} from '@ta-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Badge } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { Disclosure, DisclosurePanel, DisclosureSummary } from '../navigation/disclosure.js';

export type ToolActivityPresentationStatus = ConversationToolActivityStatus | 'interrupted';

export interface ToolActivityStatusLabels {
  readonly error: ReactNode;
  readonly interrupted: ReactNode;
  readonly pending: ReactNode;
  readonly success: ReactNode;
}

type NativeToolActivityProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface ToolActivityProps extends NativeToolActivityProps {
  readonly activity: ToolActivityValue;
  readonly detailsLabel: ReactNode;
  readonly presentationStatus?: ToolActivityPresentationStatus;
  readonly statusLabels: ToolActivityStatusLabels;
  readonly style?: never;
}

export function ToolActivity({
  activity,
  className,
  detailsLabel,
  presentationStatus = activity.status,
  statusLabels,
  ...props
}: ToolActivityProps) {
  const hasDetails = activity.summary !== undefined || activity.details.length > 0;
  const header = (
    <span className="ta-ui-tool-activity__header">
      <span className="ta-ui-tool-activity__name">{activity.toolLabel}</span>
      <Badge
        tone={
          presentationStatus === 'error'
            ? 'critical'
            : presentationStatus === 'success'
              ? 'positive'
              : presentationStatus === 'interrupted'
                ? 'caution'
                : 'neutral'
        }
      >
        {statusLabels[presentationStatus]}
      </Badge>
    </span>
  );

  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-tool-activity', className)}
      data-model-turn-index={activity.modelTurnIndex}
      data-slot="tool-activity"
      data-status={presentationStatus}
      data-tool-call-id={activity.callId}
    >
      {hasDetails ? (
        <Disclosure>
          <DisclosureSummary>
            {header}
            <span className="ta-ui-tool-activity__details-label">{detailsLabel}</span>
          </DisclosureSummary>
          <DisclosurePanel>
            {activity.summary === undefined ? null : (
              <p className="ta-ui-tool-activity__summary">{activity.summary}</p>
            )}
            {activity.details.length === 0 ? null : (
              <dl className="ta-ui-tool-activity__details">
                {activity.details.map((detail, index) => (
                  <div key={`${detail.label}:${String(index)}`}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </DisclosurePanel>
        </Disclosure>
      ) : (
        header
      )}
    </div>
  );
}
