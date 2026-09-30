import type { ComponentPropsWithRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

export type TextInputType = 'email' | 'password' | 'search' | 'tel' | 'text' | 'url';

type NativeTextInputProps = Omit<ComponentPropsWithRef<'input'>, 'style' | 'type'>;

export interface TextInputProps extends NativeTextInputProps {
  readonly style?: never;
  readonly type?: TextInputType;
}

export function TextInput({
  'aria-invalid': ariaInvalid,
  className,
  disabled = false,
  readOnly = false,
  type = 'text',
  ...props
}: TextInputProps) {
  const isInvalid = ariaInvalid === true || ariaInvalid === 'true';

  return (
    <input
      {...props}
      aria-invalid={ariaInvalid}
      className={joinStyleHooks('ta-ui-text-input', className)}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid || undefined}
      data-readonly={readOnly || undefined}
      data-slot="text-input"
      disabled={disabled}
      readOnly={readOnly}
      type={type}
    />
  );
}

type NativeTextareaProps = Omit<ComponentPropsWithRef<'textarea'>, 'style'>;

export interface TextareaProps extends NativeTextareaProps {
  readonly style?: never;
}

export function Textarea({
  'aria-invalid': ariaInvalid,
  className,
  disabled = false,
  readOnly = false,
  ...props
}: TextareaProps) {
  const isInvalid = ariaInvalid === true || ariaInvalid === 'true';

  return (
    <textarea
      {...props}
      aria-invalid={ariaInvalid}
      className={joinStyleHooks('ta-ui-textarea', className)}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid || undefined}
      data-readonly={readOnly || undefined}
      data-slot="textarea"
      disabled={disabled}
      readOnly={readOnly}
    />
  );
}

type NativeSelectProps = Omit<ComponentPropsWithRef<'select'>, 'style'>;

export interface SelectProps extends NativeSelectProps {
  readonly style?: never;
}

export function Select({
  'aria-invalid': ariaInvalid,
  className,
  disabled = false,
  ...props
}: SelectProps) {
  const isInvalid = ariaInvalid === true || ariaInvalid === 'true';

  return (
    <select
      {...props}
      aria-invalid={ariaInvalid}
      className={joinStyleHooks('ta-ui-select', className)}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid || undefined}
      data-slot="select"
      disabled={disabled}
    />
  );
}

type NativeCheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'style' | 'type'>;

export interface CheckboxProps extends NativeCheckboxProps {
  readonly style?: never;
}

export function Checkbox({ className, disabled = false, ...props }: CheckboxProps) {
  return (
    <input
      {...props}
      className={joinStyleHooks('ta-ui-checkbox', className)}
      data-disabled={disabled || undefined}
      data-slot="checkbox"
      disabled={disabled}
      type="checkbox"
    />
  );
}

type NativeSwitchProps = Omit<ComponentPropsWithRef<'input'>, 'role' | 'style' | 'type'>;

export interface SwitchProps extends NativeSwitchProps {
  readonly style?: never;
}

export function Switch({ className, disabled = false, ...props }: SwitchProps) {
  return (
    <input
      {...props}
      className={joinStyleHooks('ta-ui-switch', className)}
      data-disabled={disabled || undefined}
      data-slot="switch"
      disabled={disabled}
      role="switch"
      type="checkbox"
    />
  );
}
