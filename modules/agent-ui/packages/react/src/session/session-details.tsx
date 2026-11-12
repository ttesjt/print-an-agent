import type { SessionDetails } from '@print-an-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { DataList, DataListItem } from '../components/data-list.js';
import { Panel, PanelBody, PanelHeader } from '../components/panel.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { SessionStatusBadge, type SessionStatusLabels } from './session-catalog.js';

type NativeSessionDetailsProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style' | 'title'>;

export interface SessionDetailsViewProps extends NativeSessionDetailsProps {
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly formatTimestamp: (timestamp: string) => ReactNode;
  readonly labels: Readonly<{
    branches: ReactNode;
    createdAt: ReactNode;
    sessionId: ReactNode;
    status: ReactNode;
    turns: ReactNode;
    updatedAt: ReactNode;
  }>;
  readonly session: SessionDetails;
  readonly statusLabels: SessionStatusLabels;
  readonly style?: never;
  readonly title: ReactNode;
}

export function SessionDetailsView({
  actions,
  children,
  className,
  formatTimestamp,
  labels,
  session,
  statusLabels,
  title,
  ...props
}: SessionDetailsViewProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-session-details', className)}
      data-slot="session-details"
    >
      <Panel>
        <PanelHeader className="ta-ui-session-details__header">
          <div>
            <h2>{title}</h2>
            <p className="ta-ui-session-details__id">{session.sessionId}</p>
          </div>
          {actions}
        </PanelHeader>
        <PanelBody>
          <DataList>
            <DataListItem label={labels.sessionId} value={session.sessionId} />
            <DataListItem
              label={labels.status}
              value={
                <SessionStatusBadge label={statusLabels[session.status]} status={session.status} />
              }
            />
            <DataListItem label={labels.turns} value={session.turnCount} />
            <DataListItem label={labels.branches} value={session.branchCount} />
            <DataListItem label={labels.createdAt} value={formatTimestamp(session.createdAt)} />
            <DataListItem label={labels.updatedAt} value={formatTimestamp(session.updatedAt)} />
          </DataList>
          {children}
        </PanelBody>
      </Panel>
    </div>
  );
}
