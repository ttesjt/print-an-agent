import type { ComponentPropsWithoutRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

const PANEL_STYLE_HOOK = 'ta-ui-panel';

export type PanelVariant = 'default' | 'muted' | 'raised';

type NativePanelProps = Omit<ComponentPropsWithoutRef<'section'>, 'style'>;

export interface PanelProps extends NativePanelProps {
  readonly style?: never;
  readonly variant?: PanelVariant;
}

export function Panel({ className, variant = 'default', ...props }: PanelProps) {
  return (
    <section
      {...props}
      className={joinStyleHooks(PANEL_STYLE_HOOK, className)}
      data-slot="panel"
      data-variant={variant}
    />
  );
}

type NativePanelHeaderProps = Omit<ComponentPropsWithoutRef<'header'>, 'style'>;

export interface PanelHeaderProps extends NativePanelHeaderProps {
  readonly style?: never;
}

export function PanelHeader({ className, ...props }: PanelHeaderProps) {
  return (
    <header
      {...props}
      className={joinStyleHooks('ta-ui-panel__header', className)}
      data-slot="panel-header"
    />
  );
}

type NativePanelBodyProps = Omit<ComponentPropsWithoutRef<'div'>, 'style'>;

export interface PanelBodyProps extends NativePanelBodyProps {
  readonly style?: never;
}

export function PanelBody({ className, ...props }: PanelBodyProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-panel__body', className)}
      data-slot="panel-body"
    />
  );
}

type NativePanelFooterProps = Omit<ComponentPropsWithoutRef<'footer'>, 'style'>;

export interface PanelFooterProps extends NativePanelFooterProps {
  readonly style?: never;
}

export function PanelFooter({ className, ...props }: PanelFooterProps) {
  return (
    <footer
      {...props}
      className={joinStyleHooks('ta-ui-panel__footer', className)}
      data-slot="panel-footer"
    />
  );
}
