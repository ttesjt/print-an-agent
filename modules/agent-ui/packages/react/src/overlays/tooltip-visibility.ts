import { useCallback, useEffect, useRef, useState } from 'react';

/** Hover and focus share one presentation, but neither owns the other's close condition. */
export function useTooltipVisibility({
  closeDelayMilliseconds,
  disabled,
  hoverDelayMilliseconds,
}: Readonly<{
  closeDelayMilliseconds: number;
  disabled: boolean;
  hoverDelayMilliseconds: number;
}>) {
  const [open, setOpen] = useState(false);
  const hovered = useRef(false);
  const focused = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    openTimer.current = undefined;
    closeTimer.current = undefined;
  }, []);
  const dismiss = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);
  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => {
    if (disabled) dismiss();
  }, [disabled, dismiss]);

  const closeIfInactive = () => {
    clearTimers();
    if (hovered.current || focused.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      setOpen(false);
    }, closeDelayMilliseconds);
  };

  return {
    blur: () => {
      focused.current = false;
      closeIfInactive();
    },
    dismiss,
    focus: () => {
      focused.current = true;
      clearTimers();
      if (!disabled) setOpen(true);
    },
    open: open && !disabled,
    pointerEnter: (pointerType: string) => {
      if (pointerType === 'touch' || disabled) return;
      hovered.current = true;
      clearTimers();
      if (open) return;
      openTimer.current = setTimeout(() => {
        openTimer.current = undefined;
        setOpen(true);
      }, hoverDelayMilliseconds);
    },
    pointerLeave: (pointerType: string) => {
      if (pointerType === 'touch') return;
      hovered.current = false;
      closeIfInactive();
    },
  };
}
