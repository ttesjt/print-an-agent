import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';
import { useTooltipVisibility } from './tooltip-visibility.js';

export type TooltipPlacement = 'bottom' | 'left' | 'right' | 'top';

export interface TooltipTriggerProps {
  readonly 'aria-describedby': string | undefined;
}

type NativeTooltipProps = Omit<
  ComponentPropsWithRef<'div'>,
  | 'children'
  | 'content'
  | 'onBlurCapture'
  | 'onFocusCapture'
  | 'onPointerEnter'
  | 'onPointerLeave'
  | 'style'
>;

export interface TooltipProps extends NativeTooltipProps {
  /** Render one native focusable trigger; spread the supplied ARIA relationship onto it. */
  readonly children: (triggerProps: TooltipTriggerProps) => ReactNode;
  readonly closeDelayMilliseconds?: number;
  /** Informational content only. Commands and links belong outside a tooltip. */
  readonly content: ReactNode;
  readonly describedBy?: string;
  readonly disabled?: boolean;
  readonly hoverDelayMilliseconds?: number;
  readonly placement?: TooltipPlacement;
  readonly style?: never;
}

const DEFAULT_HOVER_DELAY_MILLISECONDS = 300;
const DEFAULT_CLOSE_DELAY_MILLISECONDS = 120;
const MAX_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

export function Tooltip({
  children,
  className,
  closeDelayMilliseconds = DEFAULT_CLOSE_DELAY_MILLISECONDS,
  content,
  describedBy,
  disabled = false,
  hoverDelayMilliseconds = DEFAULT_HOVER_DELAY_MILLISECONDS,
  placement = 'top',
  ...props
}: TooltipProps) {
  validateDelay(closeDelayMilliseconds);
  validateDelay(hoverDelayMilliseconds);
  const id = `ta-ui-tooltip-${useId()}`;
  const surface = useRef<HTMLDivElement>(null);
  const [nativePopover, setNativePopover] = useState(false);
  const visibility = useTooltipVisibility({
    closeDelayMilliseconds,
    disabled,
    hoverDelayMilliseconds,
  });
  const { dismiss, open } = visibility;

  useEffect(() => {
    const element = surface.current;
    const css = element?.ownerDocument.defaultView?.CSS;
    setNativePopover(
      element !== null &&
        typeof element?.showPopover === 'function' &&
        css?.supports('anchor-scope', '--ta-ui-tooltip-anchor') === true &&
        css.supports('position-area', 'top')
    );
  }, []);
  useEffect(() => {
    const element = surface.current;
    if (!nativePopover || !open || element === null || !element.isConnected) return;
    element.showPopover();
    return () => {
      if (element.isConnected) element.hidePopover();
    };
  }, [nativePopover, open]);
  useEffect(() => {
    const owner = surface.current?.ownerDocument;
    if (!open || owner === undefined) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss();
    };
    owner.addEventListener('keydown', escape, true);
    return () => owner.removeEventListener('keydown', escape, true);
  }, [dismiss, open]);

  const descriptions = [describedBy, disabled ? undefined : id].filter(Boolean).join(' ');
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-tooltip', className)}
      data-open={open || undefined}
      data-slot="tooltip"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) visibility.blur();
      }}
      onFocusCapture={visibility.focus}
      onPointerEnter={(event) => visibility.pointerEnter(event.pointerType)}
      onPointerLeave={(event) => visibility.pointerLeave(event.pointerType)}
    >
      <span className="ta-ui-tooltip__anchor">
        {children({ 'aria-describedby': descriptions || undefined })}
      </span>
      <div
        className="ta-ui-tooltip__content"
        data-placement={placement}
        data-positioning={nativePopover ? 'native' : 'local'}
        data-slot="tooltip-content"
        hidden={!open}
        id={id}
        popover={nativePopover ? 'manual' : undefined}
        ref={surface}
        role="tooltip"
      >
        {content}
      </div>
    </div>
  );
}

function validateDelay(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMER_DELAY_MILLISECONDS) {
    throw new RangeError('Tooltip delay must be an integer between zero and the timer maximum.');
  }
}
