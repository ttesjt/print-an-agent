import type { SessionLifecycleStatus } from '@ta-agent/ui-contracts';
import { useId, type ComponentPropsWithRef, type FormEvent, type ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { InlineError } from '../feedback/feedback.js';
import { FormField } from '../forms/form-field.js';
import { TextInput } from '../forms/controls.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { Cluster } from '../layout/cluster.js';
import { Stack } from '../layout/stack.js';
import {
  ConfirmationDialog,
  type ConfirmationDialogProps,
} from '../overlays/confirmation-dialog.js';
import { Dialog } from '../overlays/dialog.js';
import type { DialogOpenChangeDetails } from '../overlays/modal-surface.js';

type NativeSessionLifecycleActionsProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface SessionLifecycleActionsProps extends NativeSessionLifecycleActionsProps {
  readonly onRequestPurge?: () => void;
  readonly onRequestRetire?: () => void;
  readonly onRestore?: () => void;
  readonly pending?: boolean;
  readonly purgeLabel: ReactNode;
  readonly restoreLabel: ReactNode;
  readonly retireLabel: ReactNode;
  readonly status: SessionLifecycleStatus;
  readonly style?: never;
}

export function SessionLifecycleActions({
  className,
  onRequestPurge,
  onRequestRetire,
  onRestore,
  pending = false,
  purgeLabel,
  restoreLabel,
  retireLabel,
  status,
  ...props
}: SessionLifecycleActionsProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-session-lifecycle-actions', className)}
      data-slot="session-lifecycle-actions"
      data-status={status}
    >
      <Cluster justify="end" space="small">
        {status === 'active' && onRequestRetire !== undefined && (
          <Button appearance="outline" disabled={pending} onClick={onRequestRetire} tone="critical">
            {retireLabel}
          </Button>
        )}
        {status === 'retired' && onRestore !== undefined && (
          <Button onClick={onRestore} pending={pending} tone="accent">
            {restoreLabel}
          </Button>
        )}
        {status === 'retired' && onRequestPurge !== undefined && (
          <Button appearance="outline" disabled={pending} onClick={onRequestPurge} tone="critical">
            {purgeLabel}
          </Button>
        )}
      </Cluster>
    </div>
  );
}

export interface RenameSessionDialogProps {
  readonly cancelLabel: ReactNode;
  readonly description: ReactNode;
  readonly error?: ReactNode;
  readonly fieldError?: ReactNode;
  readonly label: ReactNode;
  readonly onOpenChange: (open: boolean, details: DialogOpenChangeDetails) => void;
  readonly onSubmit: () => void;
  readonly onTitleChange: (title: string) => void;
  readonly open: boolean;
  readonly pending?: boolean;
  readonly submitLabel: ReactNode;
  readonly title: ReactNode;
  readonly value: string;
}

export function RenameSessionDialog({
  cancelLabel,
  description,
  error,
  fieldError,
  label,
  onOpenChange,
  onSubmit,
  onTitleChange,
  open,
  pending = false,
  submitLabel,
  title,
  value,
}: RenameSessionDialogProps) {
  const generatedId = useId();
  const formId = `ta-ui-rename-session-${generatedId}`;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <Dialog
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
          <Button form={formId} pending={pending} type="submit">
            {submitLabel}
          </Button>
        </Cluster>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      <form
        className={joinStyleHooks('ta-ui-session-rename-form')}
        id={formId}
        onSubmit={handleSubmit}
      >
        <Stack space="medium">
          <FormField error={fieldError} label={label} required>
            {(controlProps) => (
              <TextInput
                {...controlProps}
                autoComplete="off"
                onChange={(event) => onTitleChange(event.currentTarget.value)}
                value={value}
              />
            )}
          </FormField>
          {error !== undefined && error !== null && (
            <InlineError announcement="assertive">{error}</InlineError>
          )}
        </Stack>
      </form>
    </Dialog>
  );
}

export type SessionConfirmationDialogProps = Omit<ConfirmationDialogProps, 'tone'>;

export function RetireSessionDialog(props: SessionConfirmationDialogProps) {
  return <ConfirmationDialog {...props} tone="critical" />;
}

export function PurgeSessionDialog(props: SessionConfirmationDialogProps) {
  return <ConfirmationDialog {...props} tone="critical" />;
}
