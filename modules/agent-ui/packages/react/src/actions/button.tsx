import type { ComponentPropsWithRef, ReactNode } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';
import type {
  ActionAppearance,
  ActionSize,
  ActionTone,
  IconButtonAppearance,
} from './action-types.js';

type NativeButtonProps = Omit<ComponentPropsWithRef<'button'>, 'aria-busy' | 'style'>;

export interface ButtonProps extends NativeButtonProps {
  readonly appearance?: ActionAppearance;
  readonly pending?: boolean;
  readonly size?: ActionSize;
  readonly style?: never;
  readonly tone?: ActionTone;
}

export function Button({
  appearance = 'solid',
  className,
  disabled = false,
  pending = false,
  size = 'medium',
  tone = 'accent',
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      aria-busy={pending || undefined}
      className={joinStyleHooks('ta-ui-button', className)}
      data-appearance={appearance}
      data-disabled={isDisabled || undefined}
      data-pending={pending || undefined}
      data-size={size}
      data-slot="button"
      data-tone={tone}
      disabled={isDisabled}
      type={type}
    />
  );
}

type AccessibleIconButtonName =
  | {
      readonly 'aria-label': string;
      readonly 'aria-labelledby'?: never;
    }
  | {
      readonly 'aria-label'?: never;
      readonly 'aria-labelledby': string;
    };

type NativeIconButtonProps = Omit<
  ComponentPropsWithRef<'button'>,
  'aria-busy' | 'aria-label' | 'aria-labelledby' | 'children' | 'style'
>;

interface IconButtonOwnProps extends NativeIconButtonProps {
  readonly appearance?: IconButtonAppearance;
  readonly children: ReactNode;
  readonly pending?: boolean;
  readonly size?: ActionSize;
  readonly style?: never;
  readonly tone?: ActionTone;
}

export type IconButtonProps = AccessibleIconButtonName & IconButtonOwnProps;

export function IconButton({
  appearance = 'ghost',
  className,
  disabled = false,
  pending = false,
  size = 'medium',
  tone = 'neutral',
  type = 'button',
  ...props
}: IconButtonProps) {
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      aria-busy={pending || undefined}
      className={joinStyleHooks('ta-ui-icon-button', className)}
      data-appearance={appearance}
      data-disabled={isDisabled || undefined}
      data-pending={pending || undefined}
      data-size={size}
      data-slot="icon-button"
      data-tone={tone}
      disabled={isDisabled}
      type={type}
    />
  );
}
