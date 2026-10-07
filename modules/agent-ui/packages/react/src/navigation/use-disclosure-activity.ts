import { useEffect, useRef, type RefObject } from 'react';

/** The caller owns the meaning of an activity; this is not a cancellation signal. */
export interface DisclosureActivity {
  readonly active: boolean;
  readonly autoCollapse?: boolean;
  readonly autoExpand?: boolean;
}

interface ActivityOwnership {
  active: boolean;
  automaticallyOpened: boolean;
  collapsePending: boolean;
  userControlled: boolean;
}

export function useDisclosureActivity({
  activity,
  controlled,
  element,
  open,
  setOpen,
}: Readonly<{
  activity: DisclosureActivity | undefined;
  controlled: boolean;
  element: RefObject<HTMLDetailsElement | null>;
  open: boolean;
  setOpen: (open: boolean) => void;
}>) {
  const ownership = useRef<ActivityOwnership>({
    active: false,
    automaticallyOpened: false,
    collapsePending: false,
    userControlled: false,
  });
  const active = activity?.active === true;
  const autoExpand = activity?.autoExpand === true;
  const autoCollapse = activity?.autoCollapse === true;

  useEffect(() => {
    if (controlled || ownership.current.active === active) return;
    const current = ownership.current;
    current.active = active;
    if (active) {
      const retainedAutomaticOpen = current.collapsePending && current.automaticallyOpened;
      current.collapsePending = false;
      current.userControlled = false;
      current.automaticallyOpened = retainedAutomaticOpen || (!open && autoExpand);
      if (current.automaticallyOpened && !open) setOpen(true);
      return;
    }
    if (!current.automaticallyOpened || current.userControlled || !autoCollapse) return;
    if (contentContains(element.current, element.current?.ownerDocument.activeElement)) {
      current.collapsePending = true;
      return;
    }
    current.automaticallyOpened = false;
    setOpen(false);
  }, [active, autoCollapse, autoExpand, controlled, element, open, setOpen]);

  return {
    takeControl: () => {
      ownership.current.userControlled = true;
      ownership.current.automaticallyOpened = false;
      ownership.current.collapsePending = false;
    },
    closeAfterContentBlur: (nextFocus: EventTarget | null) => {
      const current = ownership.current;
      if (!current.collapsePending || contentContains(element.current, nextFocus)) return;
      current.collapsePending = false;
      current.automaticallyOpened = false;
      if (!controlled && autoCollapse && !current.active && !current.userControlled) setOpen(false);
    },
  };
}

function contentContains(
  element: HTMLDetailsElement | null,
  target: EventTarget | null | undefined
): boolean {
  if (element === null || !(target instanceof Node) || !element.contains(target)) return false;
  return !element.querySelector(':scope > summary')?.contains(target);
}
