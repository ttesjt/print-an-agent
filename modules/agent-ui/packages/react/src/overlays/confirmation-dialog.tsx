import type { ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { Cluster } from '../layout/cluster.js';
import { Dialog, type DialogProps } from './dialog.js';
import type { DialogOpenChangeDetails } from './modal-surface.js';

export type ConfirmationTone = 'critical' | 'neutral';

type InheritedDialogProps = Omit<
  DialogProps,
  'children' | 'description' | 'dismissible' | 'footer' | 'onOpenChange' | 'title'
>;

export interface ConfirmationDialogProps extends InheritedDialogProps {
  readonly cancelLabel: ReactNode;
  readonly confirmLabel: ReactNode;
  readonly description: ReactNode;
  readonly details?: ReactNode;
  readonly error?: ReactNode;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: false, details: DialogOpenChangeDetails) => void;
  readonly pending?: boolean;
  readonly title: ReactNode;
  readonly tone?: ConfirmationTone;
}

export function ConfirmationDialog({
  cancelLabel,
  confirmLabel,
  description,
  details,
  error,
  onConfirm,
  onOpenChange,
  pending = false,
  title,
  tone = 'neutral',
  ...props
}: ConfirmationDialogProps) {
  return (
    <Dialog
      {...props}
      description={description}
      dismissible={!pending}
      footer={
        <Cluster justify="end" space="small">
          <Button
            appearance="outline"
            disabled={pending}
            onClick={() => onOpenChange(false, { reason: 'cancel-action' })}
            tone="neutral"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            pending={pending}
            tone={tone === 'critical' ? 'critical' : 'accent'}
          >
            {confirmLabel}
          </Button>
        </Cluster>
      }
      onOpenChange={onOpenChange}
      title={title}
    >
      {details}
      {error !== undefined && error !== null && (
        <div className="ta-ui-confirmation-dialog__error" data-slot="confirmation-error">
          {error}
        </div>
      )}
    </Dialog>
  );
}
