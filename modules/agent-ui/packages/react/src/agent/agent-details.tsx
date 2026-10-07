import type { AgentDetails } from '@ta-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Panel, PanelBody, PanelHeader } from '../components/panel.js';
import { DataList, DataListItem } from '../components/data-list.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { AgentStatusBadge, type AgentStatusLabels } from './agent-catalog.js';

type NativeAgentDetailsProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface AgentDetailsProps extends NativeAgentDetailsProps {
  readonly actions?: ReactNode;
  readonly agent: AgentDetails;
  readonly children?: ReactNode;
  readonly formatTimestamp: (timestamp: string) => ReactNode;
  readonly labels: Readonly<{
    agentId: ReactNode;
    createdAt: ReactNode;
    identityRevision: ReactNode;
    status: ReactNode;
    updatedAt: ReactNode;
  }>;
  readonly statusLabels: AgentStatusLabels;
  readonly style?: never;
}

export function AgentDetailsView({
  actions,
  agent,
  children,
  className,
  formatTimestamp,
  labels,
  statusLabels,
  ...props
}: AgentDetailsProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-agent-details', className)}
      data-slot="agent-details"
    >
      <Panel>
        <PanelHeader className="ta-ui-agent-details__header">
          <div>
            <h2>{agent.displayName}</h2>
            <p className="ta-ui-agent-details__id">{agent.agentId}</p>
          </div>
          {actions}
        </PanelHeader>
        <PanelBody>
          <DataList>
            <DataListItem label={labels.agentId} value={agent.agentId} />
            <DataListItem
              label={labels.status}
              value={<AgentStatusBadge label={statusLabels[agent.status]} status={agent.status} />}
            />
            <DataListItem label={labels.identityRevision} value={agent.identityRevision} />
            <DataListItem label={labels.createdAt} value={formatTimestamp(agent.createdAt)} />
            <DataListItem label={labels.updatedAt} value={formatTimestamp(agent.updatedAt)} />
          </DataList>
          {children}
        </PanelBody>
      </Panel>
    </div>
  );
}
