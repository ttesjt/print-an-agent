import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

import { InlineError } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

type NativeLabelProps = Omit<ComponentPropsWithRef<'label'>, 'style'>;

export interface LabelProps extends NativeLabelProps {
  readonly style?: never;
}

export function Label({ className, ...props }: LabelProps) {
  return (
    <label {...props} className={joinStyleHooks('ta-ui-label', className)} data-slot="label" />
  );
}

export interface FormFieldControlProps {
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-errormessage': string | undefined;
  readonly 'aria-invalid': true | undefined;
  readonly disabled: boolean;
  readonly id: string;
  readonly required: boolean;
}

type NativeFormFieldProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface FormFieldProps extends NativeFormFieldProps {
  readonly children: (controlProps: FormFieldControlProps) => ReactNode;
  readonly controlId?: string;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly error?: ReactNode;
  readonly invalid?: boolean;
  readonly label: ReactNode;
  readonly required?: boolean;
  readonly style?: never;
}

export function FormField({
  children,
  className,
  controlId,
  description,
  disabled = false,
  error,
  invalid = false,
  label,
  required = false,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const id = controlId ?? `ta-ui-field-${generatedId}`;
  const hasDescription = description !== undefined && description !== null && description !== false;
  const hasError = error !== undefined && error !== null && error !== false;
  const isInvalid = invalid || hasError;
  const descriptionId = hasDescription ? `${id}-description` : undefined;
  const errorId = hasError ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter((value) => value !== undefined).join(' ');
  const controlProps: FormFieldControlProps = Object.freeze({
    'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
    'aria-errormessage': isInvalid ? errorId : undefined,
    'aria-invalid': isInvalid ? true : undefined,
    disabled,
    id,
    required,
  });

  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-form-field', className)}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid || undefined}
      data-slot="form-field"
    >
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="ta-ui-form-field__required-indicator">
            *
          </span>
        )}
      </Label>
      {children(controlProps)}
      {hasDescription && (
        <p
          className="ta-ui-form-field__description"
          data-slot="field-description"
          id={descriptionId}
        >
          {description}
        </p>
      )}
      {hasError && <InlineError id={errorId}>{error}</InlineError>}
    </div>
  );
}

type NativeFieldsetProps = Omit<ComponentPropsWithRef<'fieldset'>, 'style'>;

export interface FieldsetProps extends NativeFieldsetProps {
  readonly style?: never;
}

export function Fieldset({ className, disabled = false, ...props }: FieldsetProps) {
  return (
    <fieldset
      {...props}
      className={joinStyleHooks('ta-ui-fieldset', className)}
      data-disabled={disabled || undefined}
      data-slot="fieldset"
      disabled={disabled}
    />
  );
}

type NativeFieldsetLegendProps = Omit<ComponentPropsWithRef<'legend'>, 'style'>;

export interface FieldsetLegendProps extends NativeFieldsetLegendProps {
  readonly style?: never;
}

export function FieldsetLegend({ className, ...props }: FieldsetLegendProps) {
  return (
    <legend
      {...props}
      className={joinStyleHooks('ta-ui-fieldset__legend', className)}
      data-slot="fieldset-legend"
    />
  );
}
