import type { ComponentPropsWithoutRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';
import type { ClusterJustification, LayoutAlignment, LayoutSpace } from './layout-types.js';

const CLUSTER_STYLE_HOOK = 'ta-ui-cluster';

type NativeClusterProps = Omit<ComponentPropsWithoutRef<'div'>, 'style'>;

export interface ClusterProps extends NativeClusterProps {
  readonly align?: LayoutAlignment;
  readonly justify?: ClusterJustification;
  readonly space?: LayoutSpace;
  readonly style?: never;
}

export function Cluster({
  align = 'center',
  className,
  justify = 'start',
  space = 'medium',
  ...props
}: ClusterProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks(CLUSTER_STYLE_HOOK, className)}
      data-align={align}
      data-justify={justify}
      data-slot="cluster"
      data-space={space}
    />
  );
}
