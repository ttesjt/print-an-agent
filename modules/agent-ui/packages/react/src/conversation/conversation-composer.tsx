import type { ComponentPropsWithRef, FormEvent, KeyboardEvent, ReactNode, Ref } from 'react';

import { Button } from '../actions/button.js';
import { Textarea } from '../forms/controls.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

export type ConversationComposerState =
  | 'cancelling'
  | 'disabled'
  | 'idle'
  | 'streaming'
  | 'submitting';

type NativeConversationComposerProps = Omit<
  ComponentPropsWithRef<'form'>,
  'children' | 'onKeyDown' | 'onSubmit' | 'style'
>;

export interface ConversationComposerProps extends NativeConversationComposerProps {
  readonly cancelLabel: ReactNode;
  readonly inputLabel: string;
  readonly inputRef?: Ref<HTMLTextAreaElement>;
  readonly onCancel?: () => void;
  readonly onSubmit: () => void;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly sendLabel: ReactNode;
  readonly state?: ConversationComposerState;
  readonly style?: never;
  readonly value: string;
}

export function ConversationComposer({
  cancelLabel,
  className,
  inputLabel,
  inputRef,
  onCancel,
  onSubmit,
  onValueChange,
  placeholder,
  sendLabel,
  state = 'idle',
  value,
  ...props
}: ConversationComposerProps) {
  const active = state === 'streaming' || state === 'cancelling' || state === 'submitting';
  const disabled = state === 'disabled';
  const canSubmit = !active && !disabled && value.trim().length > 0;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && canSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <form
      {...props}
      aria-busy={active || undefined}
      className={joinStyleHooks('ta-ui-conversation-composer', className)}
      data-slot="conversation-composer"
      data-state={state}
      onSubmit={submit}
    >
      <label className="ta-ui-conversation-composer__label">
        <span>{inputLabel}</span>
        <Textarea
          ref={inputRef}
          aria-label={inputLabel}
          disabled={disabled || active}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={keyDown}
          placeholder={placeholder}
          rows={3}
          value={value}
        />
      </label>
      <div className="ta-ui-conversation-composer__actions">
        {active && onCancel !== undefined ? (
          <Button
            appearance="outline"
            disabled={state === 'cancelling'}
            onClick={onCancel}
            tone="neutral"
          >
            {cancelLabel}
          </Button>
        ) : null}
        <Button disabled={!canSubmit} pending={state === 'submitting'} type="submit">
          {sendLabel}
        </Button>
      </div>
    </form>
  );
}
