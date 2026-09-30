import {
  type ComponentPropsWithRef,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { assignRef } from '../internal/refs.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

export type DialogCloseReason = 'cancel-action' | 'escape' | 'native-close' | 'outside-interaction';

export interface DialogOpenChangeDetails {
  readonly reason: DialogCloseReason;
}

type NativeModalProps = Omit<
  ComponentPropsWithRef<'dialog'>,
  | 'aria-describedby'
  | 'aria-labelledby'
  | 'aria-modal'
  | 'children'
  | 'onCancel'
  | 'onClick'
  | 'onPointerDown'
  | 'open'
  | 'style'
  | 'title'
>;

export interface ModalPublicProps extends NativeModalProps {
  readonly children?: ReactNode;
  readonly description?: ReactNode;
  readonly dismissible?: boolean;
  readonly footer?: ReactNode;
  readonly onOpenChange: (open: false, details: DialogOpenChangeDetails) => void;
  readonly open: boolean;
  readonly portalContainer?: HTMLElement;
  readonly style?: never;
  readonly title: ReactNode;
}

interface ModalSurfaceProps extends ModalPublicProps {
  readonly placement?: 'end' | 'start';
  readonly rootClassName: 'ta-ui-dialog' | 'ta-ui-drawer';
  readonly slotName: 'dialog' | 'drawer';
}

interface ScrollLockState {
  count: number;
  readonly previousOverflow: string;
  readonly previousPriority: string;
}

const documentScrollLocks = new WeakMap<Document, ScrollLockState>();

export function ModalSurface({
  children,
  className,
  description,
  dismissible = true,
  footer,
  onClose,
  onOpenChange,
  open,
  placement,
  portalContainer,
  ref,
  rootClassName,
  slotName,
  title,
  ...props
}: ModalSurfaceProps) {
  const [browserReady, setBrowserReady] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const internallyClosedDialogs = useRef(new WeakSet<HTMLDialogElement>());
  const openRef = useRef(open);
  const pointerStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  openRef.current = open;

  const setDialogRef = useCallback(
    (node: HTMLDialogElement | null) => {
      dialogRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  useEffect(() => setBrowserReady(true), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!browserReady || dialog === null) return;

    if (!open) {
      if (dialog.open) closeOwnedDialog(dialog, internallyClosedDialogs.current);
      return;
    }

    const ownerDocument = dialog.ownerDocument;
    const returnFocus = activeHtmlElement(ownerDocument);
    const releaseScrollLock = acquireDocumentScrollLock(ownerDocument);

    try {
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      releaseScrollLock();
      throw error;
    }

    return () => {
      if (dialog.open) closeOwnedDialog(dialog, internallyClosedDialogs.current);
      releaseScrollLock();
      if (returnFocus?.isConnected === true) returnFocus.focus();
    };
  }, [browserReady, open, portalContainer]);

  if (!browserReady) return null;
  const container = portalContainer ?? document.body;

  const requestClose = (reason: DialogCloseReason) => {
    if (dismissible) onOpenChange(false, { reason });
  };

  return createPortal(
    <dialog
      {...props}
      aria-describedby={
        description === undefined || description === null ? undefined : descriptionId
      }
      aria-labelledby={titleId}
      aria-modal="true"
      className={joinStyleHooks('ta-ui-modal-surface', rootClassName, className)}
      data-dismissible={dismissible}
      data-placement={placement}
      data-slot={slotName}
      data-state={open ? 'open' : 'closed'}
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        event.stopPropagation();
        requestClose('escape');
      }}
      onClose={(event) => {
        event.stopPropagation();
        if (internallyClosedDialogs.current.has(event.currentTarget)) {
          internallyClosedDialogs.current.delete(event.currentTarget);
          return;
        }

        const dialog = event.currentTarget;
        queueMicrotask(() => {
          if (openRef.current && !dialog.open && dialog.isConnected) dialog.showModal();
        });
        onClose?.(event);

        if (!openRef.current) return;
        requestClose('native-close');
      }}
      onClick={(event) => {
        if (pointerStartedOnBackdrop.current && event.target === event.currentTarget) {
          requestClose('outside-interaction');
        }
        pointerStartedOnBackdrop.current = false;
      }}
      onPointerDown={(event: PointerEvent<HTMLDialogElement>) => {
        pointerStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      ref={setDialogRef}
    >
      <header className={`${rootClassName}__header`} data-slot={`${slotName}-header`}>
        <h2 className={`${rootClassName}__title`} data-slot={`${slotName}-title`} id={titleId}>
          {title}
        </h2>
        {description !== undefined && description !== null && (
          <div
            className={`${rootClassName}__description`}
            data-slot={`${slotName}-description`}
            id={descriptionId}
          >
            {description}
          </div>
        )}
      </header>
      <div className={`${rootClassName}__body`} data-slot={`${slotName}-body`}>
        {children}
      </div>
      {footer !== undefined && footer !== null && (
        <footer className={`${rootClassName}__footer`} data-slot={`${slotName}-footer`}>
          {footer}
        </footer>
      )}
    </dialog>,
    container
  );
}

function acquireDocumentScrollLock(ownerDocument: Document): () => void {
  const root = ownerDocument.documentElement;
  const existing = documentScrollLocks.get(ownerDocument);
  if (existing !== undefined) {
    existing.count += 1;
  } else {
    documentScrollLocks.set(ownerDocument, {
      count: 1,
      previousOverflow: root.style.getPropertyValue('overflow'),
      previousPriority: root.style.getPropertyPriority('overflow'),
    });
    root.style.setProperty('overflow', 'hidden');
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const state = documentScrollLocks.get(ownerDocument);
    if (state === undefined) return;
    state.count -= 1;
    if (state.count > 0) return;

    if (state.previousOverflow.length === 0) root.style.removeProperty('overflow');
    else root.style.setProperty('overflow', state.previousOverflow, state.previousPriority);
    documentScrollLocks.delete(ownerDocument);
  };
}

function activeHtmlElement(ownerDocument: Document): HTMLElement | undefined {
  const activeElement = ownerDocument.activeElement;
  const elementConstructor = ownerDocument.defaultView?.HTMLElement;
  return elementConstructor !== undefined && activeElement instanceof elementConstructor
    ? activeElement
    : undefined;
}

function closeOwnedDialog(
  dialog: HTMLDialogElement,
  internallyClosedDialogs: WeakSet<HTMLDialogElement>
): void {
  internallyClosedDialogs.add(dialog);
  dialog.close();
}
