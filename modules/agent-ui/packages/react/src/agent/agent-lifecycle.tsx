import type { AgentLifecycleStatus } from '@ta-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { Cluster } from '../layout/cluster.js';
import { ConfirmationDialog } from '../overlays/confirmation-dialog.js';
import type { DialogOpenChangeDetails } from '../overlays/modal-surface.js';

type NativeAgentLifecycleActionsProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface AgentLifecycleActionsProps extends NativeAgentLifecycleActionsProps {
  readonly disableLabel: ReactNode;
  readonly onRequestDisable?: () => void;
  readonly onReactivate?: () => void;
  readonly pending?: boolean;
  readonly reactivateLabel: ReactNode;
  readonly status: AgentLifecycleStatus;
  readonly style?: never;
}

export function AgentLifecycleActions({
  className,
  disableLabel,
  onReactivate,
  onRequestDisable,
  pending = false,
  reactivateLabel,
  status,
  ...props
}: AgentLifecycleActionsProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-agent-lifecycle-actions', className)}
      data-slot="agent-lifecycle-actions"
      data-status={status}
    >
      <Cluster justify="end" space="small">
        {status === 'active' && onRequestDisable !== undefined && (
          <Button
            appearance="outline"
            disabled={pending}
            onClick={onRequestDisable}
            tone="critical"
          >
            {disableLabel}
          </Button>
        )}
        {status === 'disabled' && onReactivate !== undefined && (
          <Button onClick={onReactivate} pending={pending} tone="accent">
            {reactivateLabel}
          </Button>
        )}
      </Cluster>
    </div>
  );
}

export interface DisableAgentDialogProps {
  readonly cancelLabel: ReactNode;
  readonly confirmLabel: ReactNode;
  readonly description: ReactNode;
  readonly error?: ReactNode;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: false, details: DialogOpenChangeDetails) => void;
  readonly open: boolean;
  readonly pending?: boolean;
  readonly title: ReactNode;
}

export function DisableAgentDialog(props: DisableAgentDialogProps) {
  return <ConfirmationDialog {...props} tone="critical" />;
}
