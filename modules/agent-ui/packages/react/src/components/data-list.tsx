import type { ComponentPropsWithRef, ReactNode } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

type NativeDataListProps = Omit<ComponentPropsWithRef<'dl'>, 'style'>;

export interface DataListProps extends NativeDataListProps {
  readonly style?: never;
}

export function DataList({ className, ...props }: DataListProps) {
  return (
    <dl {...props} className={joinStyleHooks('ta-ui-data-list', className)} data-slot="data-list" />
  );
}

type NativeDataListItemProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface DataListItemProps extends NativeDataListItemProps {
  readonly label: ReactNode;
  readonly style?: never;
  readonly value: ReactNode;
}

export function DataListItem({ className, label, value, ...props }: DataListItemProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-data-list__item', className)}
      data-slot="data-list-item"
    >
      <dt className="ta-ui-data-list__label">{label}</dt>
      <dd className="ta-ui-data-list__value">{value}</dd>
    </div>
  );
}
