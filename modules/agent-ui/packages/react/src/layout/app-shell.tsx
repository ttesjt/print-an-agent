import type { ComponentPropsWithoutRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

type UnstyledDivProps = Omit<ComponentPropsWithoutRef<'div'>, 'style'> & {
  readonly style?: never;
};

type UnstyledHeaderProps = Omit<ComponentPropsWithoutRef<'header'>, 'style'> & {
  readonly style?: never;
};

type UnstyledAsideProps = Omit<ComponentPropsWithoutRef<'aside'>, 'style'> & {
  readonly style?: never;
};

type UnstyledMainProps = Omit<ComponentPropsWithoutRef<'main'>, 'style'> & {
  readonly style?: never;
};

export type AppShellProps = UnstyledDivProps;
export type AppShellHeaderProps = UnstyledHeaderProps;
export type AppShellSidebarProps = UnstyledAsideProps;
export type AppShellMainProps = UnstyledMainProps;
export type AppShellInspectorProps = UnstyledAsideProps;

export function AppShell({ className, ...props }: AppShellProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-app-shell', className)}
      data-slot="app-shell"
    />
  );
}

export function AppShellHeader({ className, ...props }: AppShellHeaderProps) {
  return (
    <header
      {...props}
      className={joinStyleHooks('ta-ui-app-shell__header', className)}
      data-slot="app-shell-header"
    />
  );
}

export function AppShellSidebar({ className, ...props }: AppShellSidebarProps) {
  return (
    <aside
      {...props}
      className={joinStyleHooks('ta-ui-app-shell__sidebar', className)}
      data-slot="app-shell-sidebar"
    />
  );
}

export function AppShellMain({ className, ...props }: AppShellMainProps) {
  return (
    <main
      {...props}
      className={joinStyleHooks('ta-ui-app-shell__main', className)}
      data-slot="app-shell-main"
    />
  );
}

export function AppShellInspector({ className, ...props }: AppShellInspectorProps) {
  return (
    <aside
      {...props}
      className={joinStyleHooks('ta-ui-app-shell__inspector', className)}
      data-slot="app-shell-inspector"
    />
  );
}
