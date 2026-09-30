import type { ComponentPropsWithRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

type AccessibleNavigationName =
  | {
      readonly 'aria-label': string;
      readonly 'aria-labelledby'?: never;
    }
  | {
      readonly 'aria-label'?: never;
      readonly 'aria-labelledby': string;
    };

type NativeNavigationRailProps = Omit<
  ComponentPropsWithRef<'nav'>,
  'aria-label' | 'aria-labelledby' | 'style'
>;

export type NavigationRailProps = NativeNavigationRailProps &
  AccessibleNavigationName & {
    readonly style?: never;
  };

export function NavigationRail({ className, ...props }: NavigationRailProps) {
  return (
    <nav
      {...props}
      className={joinStyleHooks('ta-ui-navigation-rail', className)}
      data-slot="navigation-rail"
    />
  );
}

type UnstyledDivProps = Omit<ComponentPropsWithRef<'div'>, 'style'> & {
  readonly style?: never;
};

export type NavigationRailHeaderProps = UnstyledDivProps;
export type NavigationRailBodyProps = UnstyledDivProps;
export type NavigationRailFooterProps = UnstyledDivProps;

export function NavigationRailHeader({ className, ...props }: NavigationRailHeaderProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-navigation-rail__header', className)}
      data-slot="navigation-rail-header"
    />
  );
}

export function NavigationRailBody({ className, ...props }: NavigationRailBodyProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-navigation-rail__body', className)}
      data-slot="navigation-rail-body"
    />
  );
}

export function NavigationRailFooter({ className, ...props }: NavigationRailFooterProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-navigation-rail__footer', className)}
      data-slot="navigation-rail-footer"
    />
  );
}
