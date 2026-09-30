import type { ComponentPropsWithoutRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';
import type { LayoutAlignment, LayoutSpace } from './layout-types.js';

const STACK_STYLE_HOOK = 'ta-ui-stack';

type NativeStackProps = Omit<ComponentPropsWithoutRef<'div'>, 'style'>;

export interface StackProps extends NativeStackProps {
  readonly align?: LayoutAlignment;
  readonly space?: LayoutSpace;
  readonly style?: never;
}

export function Stack({ align = 'stretch', className, space = 'medium', ...props }: StackProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks(STACK_STYLE_HOOK, className)}
      data-align={align}
      data-slot="stack"
      data-space={space}
    />
  );
}
