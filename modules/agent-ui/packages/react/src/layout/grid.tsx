import type { ComponentPropsWithoutRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';
import type { GridColumns, LayoutSpace } from './layout-types.js';

const GRID_STYLE_HOOK = 'ta-ui-grid';

type NativeGridProps = Omit<ComponentPropsWithoutRef<'div'>, 'style'>;

export interface GridProps extends NativeGridProps {
  readonly columns?: GridColumns;
  readonly space?: LayoutSpace;
  readonly style?: never;
}

export function Grid({ className, columns = 'auto', space = 'medium', ...props }: GridProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks(GRID_STYLE_HOOK, className)}
      data-columns={columns}
      data-slot="grid"
      data-space={space}
    />
  );
}
