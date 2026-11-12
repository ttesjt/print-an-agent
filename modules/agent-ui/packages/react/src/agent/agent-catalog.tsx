import type { AgentLifecycleStatus, AgentSummary } from '@print-an-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { Alert, Badge, EmptyState, Spinner } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

export type AgentCatalogState =
  | Readonly<{ status: 'failed'; error: ReactNode }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; agents: readonly AgentSummary[] }>;

type NativeAgentCatalogProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface AgentCatalogProps extends NativeAgentCatalogProps {
  readonly createAction?: ReactNode;
  readonly emptyDescription?: ReactNode;
  readonly emptyTitle: ReactNode;
  readonly loadingLabel: string;
  readonly onRetry?: () => void;
  readonly onSelectAgent: (agentId: string) => void;
  readonly retryLabel?: ReactNode;
  readonly selectedAgentId?: string | undefined;
  readonly state: AgentCatalogState;
  readonly statusLabels: AgentStatusLabels;
  readonly style?: never;
  readonly workingAgentIds?: readonly string[];
  readonly workingLabel: string;
}

export function AgentCatalog({
  className,
  createAction,
  emptyDescription,
  emptyTitle,
  loadingLabel,
  onRetry,
  onSelectAgent,
  retryLabel,
  selectedAgentId,
  state,
  statusLabels,
  workingAgentIds = [],
  workingLabel,
  ...props
}: AgentCatalogProps) {
  let content: ReactNode;
  if (state.status === 'loading') {
    content = (
      <div className="ta-ui-agent-catalog__loading" data-slot="agent-catalog-loading">
        <Spinner announcement="polite" label={loadingLabel} />
        <span>{loadingLabel}</span>
      </div>
    );
  } else if (state.status === 'failed') {
    content = (
      <Alert announcement="assertive" className="ta-ui-agent-catalog__error" tone="critical">
        <span>{state.error}</span>
        {onRetry !== undefined && retryLabel !== undefined && (
          <Button appearance="outline" onClick={onRetry} size="small" tone="neutral">
            {retryLabel}
          </Button>
        )}
      </Alert>
    );
  } else if (state.agents.length === 0) {
    content = (
      <EmptyState actions={createAction} description={emptyDescription} title={emptyTitle} />
    );
  } else {
    content = (
      <AgentList
        agents={state.agents}
        onSelectAgent={onSelectAgent}
        selectedAgentId={selectedAgentId}
        statusLabels={statusLabels}
        workingAgentIds={workingAgentIds}
        workingLabel={workingLabel}
      />
    );
  }

  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-agent-catalog', className)}
      data-slot="agent-catalog"
      data-state={state.status}
    >
      {content}
      {state.status === 'ready' && state.agents.length > 0 ? createAction : null}
    </div>
  );
}

type NativeAgentListProps = Omit<ComponentPropsWithRef<'ul'>, 'children' | 'style'>;

export interface AgentListProps extends NativeAgentListProps {
  readonly agents: readonly AgentSummary[];
  readonly onSelectAgent: (agentId: string) => void;
  readonly selectedAgentId?: string | undefined;
  readonly statusLabels: AgentStatusLabels;
  readonly style?: never;
  readonly workingAgentIds?: readonly string[];
  readonly workingLabel: string;
}

export function AgentList({
  agents,
  className,
  onSelectAgent,
  selectedAgentId,
  statusLabels,
  workingAgentIds = [],
  workingLabel,
  ...props
}: AgentListProps) {
  return (
    <ul {...props} className={joinStyleHooks('ta-ui-agent-list', className)} data-slot="agent-list">
      {agents.map((agent) => (
        <AgentListItem
          agent={agent}
          key={agent.agentId}
          onSelect={() => onSelectAgent(agent.agentId)}
          selected={selectedAgentId === agent.agentId}
          statusLabel={statusLabels[agent.status]}
          working={workingAgentIds.includes(agent.agentId)}
          workingLabel={workingLabel}
        />
      ))}
    </ul>
  );
}

type NativeAgentListItemProps = Omit<ComponentPropsWithRef<'li'>, 'children' | 'style'>;

export interface AgentListItemProps extends NativeAgentListItemProps {
  readonly agent: AgentSummary;
  readonly onSelect: () => void;
  readonly selected?: boolean;
  readonly statusLabel: ReactNode;
  readonly style?: never;
  readonly working?: boolean;
  readonly workingLabel: string;
}

export function AgentListItem({
  agent,
  className,
  onSelect,
  selected = false,
  statusLabel,
  working = false,
  workingLabel,
  ...props
}: AgentListItemProps) {
  return (
    <li
      {...props}
      className={joinStyleHooks('ta-ui-agent-list__item', className)}
      data-selected={selected || undefined}
      data-slot="agent-list-item"
      data-status={agent.status}
      data-working={working || undefined}
    >
      <button
        aria-busy={working || undefined}
        aria-current={selected ? 'true' : undefined}
        className="ta-ui-agent-list__button"
        onClick={onSelect}
        type="button"
      >
        <span className="ta-ui-agent-list__identity">
          <span className="ta-ui-agent-list__name">{agent.displayName}</span>
          <span className="ta-ui-agent-list__id">{agent.agentId}</span>
        </span>
        {working ? (
          <span className="ta-ui-agent-list__working">
            <Spinner decorative />
            <span>{workingLabel}</span>
          </span>
        ) : (
          <AgentStatusBadge label={statusLabel} status={agent.status} />
        )}
      </button>
    </li>
  );
}

export type AgentStatusLabels = Readonly<Record<AgentLifecycleStatus, ReactNode>>;

export interface AgentStatusBadgeProps {
  readonly label: ReactNode;
  readonly status: AgentLifecycleStatus;
}

export function AgentStatusBadge({ label, status }: AgentStatusBadgeProps) {
  return (
    <Badge data-agent-status={status} tone={status === 'active' ? 'positive' : 'neutral'}>
      {label}
    </Badge>
  );
}
