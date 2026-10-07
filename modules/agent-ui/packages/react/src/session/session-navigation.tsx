import type { SessionBranchSummary, SessionNavigationSnapshot } from '@ta-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Badge } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

type NativeSessionNavigationProps = Omit<
  ComponentPropsWithRef<'section'>,
  'children' | 'style' | 'title'
>;

export interface SessionNavigationViewProps extends NativeSessionNavigationProps {
  readonly formatBranchDescription: (branch: SessionBranchSummary) => ReactNode;
  readonly getBranchLabel: (branch: SessionBranchSummary) => ReactNode;
  readonly navigation: SessionNavigationSnapshot;
  readonly onSelectBranch?: (branchId: string) => void;
  readonly selectedLabel: ReactNode;
  readonly style?: never;
  readonly title: ReactNode;
  readonly workingBranchId?: string;
  readonly workingLabel: ReactNode;
}

export function SessionNavigationView({
  className,
  formatBranchDescription,
  getBranchLabel,
  navigation,
  onSelectBranch,
  selectedLabel,
  title,
  workingBranchId,
  workingLabel,
  ...props
}: SessionNavigationViewProps) {
  return (
    <section
      {...props}
      className={joinStyleHooks('ta-ui-session-navigation', className)}
      data-slot="session-navigation"
    >
      <h3>{title}</h3>
      <SessionBranchList
        formatBranchDescription={formatBranchDescription}
        getBranchLabel={getBranchLabel}
        navigation={navigation}
        selectedLabel={selectedLabel}
        workingLabel={workingLabel}
        {...(onSelectBranch === undefined ? {} : { onSelectBranch })}
        {...(workingBranchId === undefined ? {} : { workingBranchId })}
      />
    </section>
  );
}

export interface SessionBranchListProps extends Omit<ComponentPropsWithRef<'ul'>, 'children'> {
  readonly formatBranchDescription: (branch: SessionBranchSummary) => ReactNode;
  readonly getBranchLabel: (branch: SessionBranchSummary) => ReactNode;
  readonly navigation: SessionNavigationSnapshot;
  readonly onSelectBranch?: (branchId: string) => void;
  readonly selectedLabel: ReactNode;
  readonly workingBranchId?: string;
  readonly workingLabel: ReactNode;
}

export function SessionBranchList({
  className,
  formatBranchDescription,
  getBranchLabel,
  navigation,
  onSelectBranch,
  selectedLabel,
  workingBranchId,
  workingLabel,
  ...props
}: SessionBranchListProps) {
  return (
    <ul
      {...props}
      className={joinStyleHooks('ta-ui-session-branch-list', className)}
      data-slot="session-branch-list"
    >
      {navigation.branches.map((branch) => (
        <SessionBranchItem
          branch={branch}
          description={formatBranchDescription(branch)}
          disabled={
            workingBranchId !== undefined || branch.branchId === navigation.selectedBranchId
          }
          key={branch.branchId}
          label={getBranchLabel(branch)}
          selected={branch.branchId === navigation.selectedBranchId}
          selectedLabel={selectedLabel}
          working={branch.branchId === workingBranchId}
          workingLabel={workingLabel}
          {...(onSelectBranch === undefined
            ? {}
            : { onSelect: () => onSelectBranch(branch.branchId) })}
        />
      ))}
    </ul>
  );
}

export interface SessionBranchItemProps extends Omit<ComponentPropsWithRef<'li'>, 'children'> {
  readonly branch: SessionBranchSummary;
  readonly description: ReactNode;
  readonly disabled?: boolean;
  readonly label: ReactNode;
  readonly onSelect?: () => void;
  readonly selected?: boolean;
  readonly selectedLabel: ReactNode;
  readonly working?: boolean;
  readonly workingLabel: ReactNode;
}

export function SessionBranchItem({
  branch,
  className,
  description,
  disabled = false,
  label,
  onSelect,
  selected = false,
  selectedLabel,
  working = false,
  workingLabel,
  ...props
}: SessionBranchItemProps) {
  return (
    <li
      {...props}
      className={joinStyleHooks('ta-ui-session-branch-list__item', className)}
      data-branch-id={branch.branchId}
      data-selected={selected || undefined}
      data-slot="session-branch-item"
    >
      <button
        aria-busy={working || undefined}
        aria-current={selected ? 'true' : undefined}
        className="ta-ui-session-branch-list__button"
        disabled={disabled || onSelect === undefined || working}
        onClick={onSelect}
        type="button"
      >
        <span>
          <span className="ta-ui-session-branch-list__label">{label}</span>
          <span className="ta-ui-session-branch-list__description">{description}</span>
        </span>
        {working ? <Badge tone="neutral">{workingLabel}</Badge> : null}
        {!working && selected ? <Badge tone="accent">{selectedLabel}</Badge> : null}
      </button>
    </li>
  );
}
