import type { ComponentPropsWithRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

type NativeActionBarProps = Omit<ComponentPropsWithRef<'div'>, 'role' | 'style'>;

/** A command/information group with native Tab navigation, not an ARIA toolbar or menu. */
export interface ActionBarProps extends NativeActionBarProps {
  readonly 'aria-label': string;
  readonly style?: never;
}

export function ActionBar({ className, ...props }: ActionBarProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-action-bar', className)}
      data-slot="action-bar"
      role="group"
    />
  );
}
