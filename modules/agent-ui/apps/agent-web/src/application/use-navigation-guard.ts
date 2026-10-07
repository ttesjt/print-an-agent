import { useCallback, useEffect, useRef, useState } from 'react';

/** Application-only unsaved-edit boundary, not a reusable component router. */
export function useNavigationGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const pendingAction = useRef<Readonly<{ accept: () => void; reject?: () => void }> | undefined>(
    undefined
  );
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const request = useCallback((accept: () => void, reject?: () => void) => {
    if (!dirtyRef.current) {
      accept();
      return;
    }
    pendingAction.current = { accept, ...(reject === undefined ? {} : { reject }) };
    setPending(true);
  }, []);
  const settle = (accepted: boolean) => {
    const action = pendingAction.current;
    pendingAction.current = undefined;
    setPending(false);
    if (accepted) action?.accept();
    else action?.reject?.();
  };
  return { request, pending, confirm: () => settle(true), cancel: () => settle(false) };
}
