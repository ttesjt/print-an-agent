import type { ComponentPropsWithRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';
import type { ActionSize, ActionTone } from './action-types.js';

type NativeAnchorProps = Omit<ComponentPropsWithRef<'a'>, 'style'>;

export interface TextLinkProps extends NativeAnchorProps {
  readonly href: string;
  readonly size?: ActionSize;
  readonly style?: never;
  readonly tone?: ActionTone;
}

export function TextLink({ className, size = 'medium', tone = 'accent', ...props }: TextLinkProps) {
  return (
    <a
      {...props}
      className={joinStyleHooks('ta-ui-text-link', className)}
      data-size={size}
      data-slot="text-link"
      data-tone={tone}
    />
  );
}
