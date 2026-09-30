import type { ComponentPropsWithRef } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';
import { useControllableState } from '../internal/use-controllable-state.js';

type NativeDisclosureProps = Omit<ComponentPropsWithRef<'details'>, 'open' | 'style'>;

interface SharedDisclosureProps extends NativeDisclosureProps {
  readonly onOpenChange?: (open: boolean) => void;
  readonly style?: never;
}

interface ControlledDisclosureProps extends SharedDisclosureProps {
  readonly defaultOpen?: never;
  readonly open: boolean;
}

interface UncontrolledDisclosureProps extends SharedDisclosureProps {
  readonly defaultOpen?: boolean;
  readonly open?: never;
}

export type DisclosureProps = ControlledDisclosureProps | UncontrolledDisclosureProps;

export function Disclosure({
  className,
  defaultOpen = false,
  onOpenChange,
  onToggle,
  open,
  ...props
}: DisclosureProps) {
  const isControlled = open !== undefined;
  const [isOpen, setOpen] = useControllableState({
    defaultValue: defaultOpen,
    onValueChange: onOpenChange,
    value: open,
  });

  return (
    <details
      {...props}
      className={joinStyleHooks('ta-ui-disclosure', className)}
      data-slot="disclosure"
      data-state={isOpen ? 'open' : 'closed'}
      onToggle={(event) => {
        onToggle?.(event);
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (isControlled && nextOpen !== isOpen) event.currentTarget.open = isOpen;
      }}
      open={isOpen}
    />
  );
}

type NativeDisclosureSummaryProps = Omit<ComponentPropsWithRef<'summary'>, 'style'>;

export interface DisclosureSummaryProps extends NativeDisclosureSummaryProps {
  readonly style?: never;
}

export function DisclosureSummary({ className, ...props }: DisclosureSummaryProps) {
  return (
    <summary
      {...props}
      className={joinStyleHooks('ta-ui-disclosure__summary', className)}
      data-slot="disclosure-summary"
    />
  );
}

type NativeDisclosurePanelProps = Omit<ComponentPropsWithRef<'div'>, 'style'>;

export interface DisclosurePanelProps extends NativeDisclosurePanelProps {
  readonly style?: never;
}

export function DisclosurePanel({ className, ...props }: DisclosurePanelProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-disclosure__panel', className)}
      data-slot="disclosure-panel"
    />
  );
}
