import { useRef, type ComponentPropsWithRef, type MouseEvent } from 'react';

import { assignRef } from '../internal/refs.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { useControllableState } from '../internal/use-controllable-state.js';
import { useDisclosureActivity, type DisclosureActivity } from './use-disclosure-activity.js';

export type { DisclosureActivity } from './use-disclosure-activity.js';

type NativeDisclosureProps = Omit<ComponentPropsWithRef<'details'>, 'open' | 'style'>;

export type DisclosureAppearance = 'plain' | 'surface';

interface SharedDisclosureProps extends NativeDisclosureProps {
  readonly appearance?: DisclosureAppearance;
  readonly style?: never;
}

interface ControlledDisclosureState {
  readonly activity?: never;
  readonly defaultOpen?: never;
  readonly open: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

interface UncontrolledDisclosureState {
  readonly activity?: DisclosureActivity;
  readonly defaultOpen?: boolean;
  readonly open?: never;
  readonly onOpenChange?: (open: boolean) => void;
}

export type DisclosureStateProps = ControlledDisclosureState | UncontrolledDisclosureState;
export type DisclosureProps = SharedDisclosureProps & DisclosureStateProps;

export function Disclosure({
  activity,
  appearance = 'surface',
  className,
  defaultOpen = false,
  onBlur,
  onClick,
  onOpenChange,
  onToggle,
  open,
  ref,
  ...props
}: DisclosureProps) {
  const element = useRef<HTMLDetailsElement>(null);
  const isControlled = open !== undefined;
  const [isOpen, setOpen] = useControllableState({
    defaultValue: defaultOpen,
    onValueChange: onOpenChange,
    value: open,
  });
  const behavior = useDisclosureActivity({
    activity,
    controlled: isControlled,
    element,
    open: isOpen,
    setOpen,
  });

  return (
    <details
      {...props}
      className={joinStyleHooks('ta-ui-disclosure', className)}
      data-appearance={appearance}
      data-slot="disclosure"
      data-state={isOpen ? 'open' : 'closed'}
      onBlur={(event) => {
        onBlur?.(event);
        behavior.closeAfterContentBlur(event.relatedTarget);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isSummaryActivation(event)) return;
        // Native toggle also fires for programmatic changes. Record actual activation here.
        event.preventDefault();
        behavior.takeControl();
        setOpen(!isOpen);
      }}
      onToggle={(event) => {
        if (event.target !== event.currentTarget) return;
        onToggle?.(event);
        const nextOpen = event.currentTarget.open;
        if (nextOpen !== isOpen) {
          behavior.takeControl();
          setOpen(nextOpen);
          if (isControlled) event.currentTarget.open = isOpen;
        }
      }}
      open={isOpen}
      ref={(node) => {
        element.current = node;
        assignRef(ref, node);
      }}
    />
  );
}

function isSummaryActivation(event: MouseEvent<HTMLDetailsElement>): boolean {
  if (!(event.target instanceof Element)) return false;
  const summary = event.target.closest('summary');
  if (summary?.parentElement !== event.currentTarget) return false;
  const interactive = event.target.closest('a[href], button, input, select, textarea');
  return interactive === null || !summary.contains(interactive);
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

export type DisclosureContentMaxHeight = 'small' | 'medium' | 'large';

interface SharedDisclosurePanelProps extends NativeDisclosurePanelProps {
  readonly style?: never;
}

type NamedScrollRegion =
  | Readonly<{ 'aria-label': string }>
  | Readonly<{ 'aria-labelledby': string }>;

export type DisclosurePanelProps = SharedDisclosurePanelProps &
  (
    | Readonly<{ contentMaxHeight?: never }>
    | (Readonly<{ contentMaxHeight: DisclosureContentMaxHeight }> & NamedScrollRegion)
  );

export function DisclosurePanel({
  className,
  contentMaxHeight,
  role,
  tabIndex,
  ...props
}: DisclosurePanelProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-disclosure__panel', className)}
      data-content-max-height={contentMaxHeight}
      data-slot="disclosure-panel"
      role={role ?? (contentMaxHeight === undefined ? undefined : 'region')}
      tabIndex={tabIndex ?? (contentMaxHeight === undefined ? undefined : 0)}
    />
  );
}
