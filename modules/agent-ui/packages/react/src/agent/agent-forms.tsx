import type { AgentIdentityDraft } from '@ta-agent/ui-contracts';
import { useId, type ComponentPropsWithRef, type FormEvent, type ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { Alert, InlineError } from '../feedback/feedback.js';
import { FormField } from '../forms/form-field.js';
import { TextInput } from '../forms/controls.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { Cluster } from '../layout/cluster.js';
import { Stack } from '../layout/stack.js';
import { Dialog } from '../overlays/dialog.js';
import type { DialogOpenChangeDetails } from '../overlays/modal-surface.js';

export interface AgentIdentityFieldErrors {
  readonly agentId?: ReactNode;
  readonly displayName?: ReactNode;
}

export interface AgentCreateDialogProps {
  readonly cancelLabel: ReactNode;
  readonly configFields?: ReactNode;
  readonly description: ReactNode;
  readonly error?: ReactNode;
  readonly fieldErrors?: AgentIdentityFieldErrors;
  readonly identity: AgentIdentityDraft;
  readonly labels: Readonly<{ agentId: ReactNode; displayName: ReactNode }>;
  readonly onIdentityChange: (identity: AgentIdentityDraft) => void;
  readonly onOpenChange: (open: boolean, details: DialogOpenChangeDetails) => void;
  readonly onSubmit: () => void;
  readonly open: boolean;
  readonly pending?: boolean;
  readonly submitLabel: ReactNode;
  readonly title: ReactNode;
}

export function AgentCreateDialog({
  cancelLabel,
  configFields,
  description,
  error,
  fieldErrors = {},
  identity,
  labels,
  onIdentityChange,
  onOpenChange,
  onSubmit,
  open,
  pending = false,
  submitLabel,
  title,
}: AgentCreateDialogProps) {
  const generatedId = useId();
  const formId = `ta-ui-agent-create-${generatedId}`;
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
        className={joinStyleHooks('ta-ui-agent-create-form')}
        id={formId}
        onSubmit={handleSubmit}
      >
        <Stack space="medium">
          <FormField error={fieldErrors.agentId} label={labels.agentId} required>
            {(controlProps) => (
              <TextInput
                {...controlProps}
                autoComplete="off"
                name="agentId"
                onChange={(event) =>
                  onIdentityChange({ ...identity, agentId: event.currentTarget.value })
                }
                value={identity.agentId}
              />
            )}
          </FormField>
          <FormField error={fieldErrors.displayName} label={labels.displayName} required>
            {(controlProps) => (
              <TextInput
                {...controlProps}
                autoComplete="off"
                name="displayName"
                onChange={(event) =>
                  onIdentityChange({ ...identity, displayName: event.currentTarget.value })
                }
                value={identity.displayName}
              />
            )}
          </FormField>
          {configFields}
          {error !== undefined && error !== null && (
            <InlineError announcement="assertive">{error}</InlineError>
          )}
        </Stack>
      </form>
    </Dialog>
  );
}

type NativeConfigSectionProps = Omit<
  ComponentPropsWithRef<'section'>,
  'children' | 'style' | 'title'
>;

export interface ConfigSectionProps extends NativeConfigSectionProps {
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly status?: ReactNode;
  readonly style?: never;
  readonly title: ReactNode;
}

export function ConfigSection({
  actions,
  children,
  className,
  description,
  status,
  title,
  ...props
}: ConfigSectionProps) {
  return (
    <section
      {...props}
      className={joinStyleHooks('ta-ui-config-section', className)}
      data-slot="config-section"
    >
      <header className="ta-ui-config-section__header">
        <div>
          <h3>{title}</h3>
          {description !== undefined && description !== null && <p>{description}</p>}
        </div>
        {status}
        {actions}
      </header>
      <div className="ta-ui-config-section__body">{children}</div>
    </section>
  );
}

type NativeAgentConfigFormProps = Omit<
  ComponentPropsWithRef<'form'>,
  'children' | 'onReset' | 'onSubmit' | 'style'
>;

export interface AgentConfigFormProps extends NativeAgentConfigFormProps {
  readonly cancelLabel: ReactNode;
  readonly children: ReactNode;
  readonly conflict?: ReactNode;
  readonly conflictActions?: ReactNode;
  readonly dirty: boolean;
  readonly error?: ReactNode;
  readonly invalid?: boolean;
  readonly onReset: () => void;
  readonly onSubmit: () => void;
  readonly pending?: boolean;
  readonly saveLabel: ReactNode;
  readonly style?: never;
}

export function AgentConfigForm({
  cancelLabel,
  children,
  className,
  conflict,
  conflictActions,
  dirty,
  error,
  invalid = false,
  onReset,
  onSubmit,
  pending = false,
  saveLabel,
  ...props
}: AgentConfigFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form
      {...props}
      aria-busy={pending || undefined}
      className={joinStyleHooks('ta-ui-agent-config-form', className)}
      data-dirty={dirty || undefined}
      data-invalid={invalid || undefined}
      data-pending={pending || undefined}
      data-slot="agent-config-form"
      onSubmit={handleSubmit}
    >
      <Stack space="medium">
        {conflict !== undefined && conflict !== null && (
          <Alert announcement="assertive" tone="caution">
            <span>{conflict}</span>
            {conflictActions}
          </Alert>
        )}
        {children}
        {error !== undefined && error !== null && (
          <InlineError announcement="assertive">{error}</InlineError>
        )}
        <Cluster justify="end" space="small">
          <Button
            appearance="outline"
            disabled={!dirty || pending}
            onClick={onReset}
            tone="neutral"
          >
            {cancelLabel}
          </Button>
          <Button disabled={!dirty || invalid} pending={pending} type="submit">
            {saveLabel}
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}
