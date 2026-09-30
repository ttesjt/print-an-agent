import { act, createRef, useRef, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ConfirmationDialog,
  Dialog,
  Drawer,
  type DialogOpenChangeDetails,
} from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(() => {
  cleanupReactRoots();
  document.documentElement.style.removeProperty('overflow');
});
afterAll(disableReactActEnvironment);

describe('overlay primitives', () => {
  it('owns modal lifecycle, explicit dismissal, focus restore, and scroll cleanup', () => {
    const onOpenChange = vi.fn();
    const container = renderInDocument(<DialogHarness onOpenChange={onOpenChange} />);
    const trigger = container.querySelector<HTMLButtonElement>('[data-trigger]');

    act(() => {
      trigger?.focus();
      trigger?.click();
    });

    const dialog = document.querySelector<HTMLDialogElement>('[data-slot="dialog"]');
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(
      dialog?.querySelector('[data-slot="dialog-title"]')?.id
    );
    expect(dialog?.getAttribute('aria-describedby')).toBe(
      dialog?.querySelector('[data-slot="dialog-description"]')?.id
    );
    expect(document.documentElement.style.overflow).toBe('hidden');

    act(() => {
      dialog?.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false, { reason: 'escape' });
    expect(dialog?.open).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);

    act(() => trigger?.click());
    const reopenedDialog = document.querySelector<HTMLDialogElement>('[data-slot="dialog"]');
    act(() => {
      reopenedDialog?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      reopenedDialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false, { reason: 'outside-interaction' });
    expect(reopenedDialog?.open).toBe(false);
  });

  it('distinguishes outside interaction, dismiss policy, and explicit portal ownership', () => {
    const onOpenChange = vi.fn();
    const portalContainer = document.createElement('section');
    document.body.append(portalContainer);
    renderInDocument(
      <Dialog
        dismissible={false}
        onOpenChange={onOpenChange}
        open
        portalContainer={portalContainer}
        title="Locked operation"
      >
        Cannot dismiss yet.
      </Dialog>
    );
    const dialog = portalContainer.querySelector<HTMLDialogElement>('[data-slot="dialog"]');

    act(() => {
      dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
      dialog?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialog?.open).toBe(true);
  });

  it('routes form method=dialog closure through the controlled owner', () => {
    const onClose = vi.fn();
    const onOpenChange = vi.fn();
    const container = renderInDocument(
      <ControlledNativeCloseHarness onClose={onClose} onOpenChange={onOpenChange} />
    );
    const trigger = container.querySelector<HTMLButtonElement>('[data-open-native]');

    act(() => {
      trigger?.focus();
      trigger?.click();
    });
    expect(document.querySelector<HTMLDialogElement>('dialog')?.open).toBe(true);

    const form = document.querySelector<HTMLFormElement>('form[method="dialog"]');
    expect(form).not.toBeNull();
    act(() => document.querySelector<HTMLDialogElement>('dialog')?.close());

    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false, { reason: 'native-close' });
    expect(document.querySelector<HTMLDialogElement>('dialog')?.open).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('routes public ref closure through the controlled owner', () => {
    const onOpenChange = vi.fn();
    const container = renderInDocument(
      <ControlledNativeCloseHarness onOpenChange={onOpenChange} />
    );

    act(() => container.querySelector<HTMLButtonElement>('[data-open-native]')?.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-ref-close]')?.click());

    expect(onOpenChange).toHaveBeenCalledWith(false, { reason: 'native-close' });
    expect(document.querySelector<HTMLDialogElement>('dialog')?.open).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('restores a non-dismissible modal after an imperative native close', async () => {
    const dialogRef = createRef<HTMLDialogElement>();
    const onClose = vi.fn();
    const onOpenChange = vi.fn();
    renderInDocument(
      <Dialog
        dismissible={false}
        onClose={onClose}
        onOpenChange={onOpenChange}
        open
        ref={dialogRef}
        title="Locked modal"
      />
    );

    await act(async () => {
      dialogRef.current?.close();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialogRef.current?.open).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('restores a native-closed modal when the controlled owner declines the request', async () => {
    const dialogRef = createRef<HTMLDialogElement>();
    const onOpenChange = vi.fn();
    renderInDocument(
      <Dialog onOpenChange={onOpenChange} open ref={dialogRef} title="Owner-retained modal" />
    );

    await act(async () => {
      dialogRef.current?.close();
      await Promise.resolve();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false, { reason: 'native-close' });
    expect(dialogRef.current?.open).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('retains document scroll lock until every nested modal releases its lease', () => {
    document.documentElement.style.overflow = 'clip';
    const container = renderInDocument(<NestedDialogHarness />);

    expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
    expect(document.documentElement.style.overflow).toBe('hidden');

    const innerDialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].find(
      (dialog) => dialog.textContent?.includes('Inner')
    );
    act(() => {
      innerDialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect(document.documentElement.style.overflow).toBe('hidden');

    act(() => container.querySelector<HTMLButtonElement>('[data-close-outer]')?.click());
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
    expect(document.documentElement.style.overflow).toBe('clip');
  });

  it('releases modal resources when an open owner unmounts', () => {
    document.documentElement.style.overflow = 'visible';
    renderInDocument(<Dialog onOpenChange={() => undefined} open title="Unmounting" />);
    expect(document.documentElement.style.overflow).toBe('hidden');

    cleanupReactRoots();
    expect(document.documentElement.style.overflow).toBe('visible');
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('keeps Drawer modal and makes confirmation pending state fail closed', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    renderInDocument(
      <div>
        <Drawer onOpenChange={onOpenChange} open placement="start" title="Session navigation">
          Modal navigation
        </Drawer>
        <ConfirmationDialog
          cancelLabel="Cancel"
          confirmLabel="Disable"
          description="This Agent will stop accepting requests."
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
          open
          pending
          title="Disable Agent?"
          tone="critical"
        />
      </div>
    );

    const drawer = document.querySelector<HTMLDialogElement>('[data-slot="drawer"]');
    const confirmation = [
      ...document.querySelectorAll<HTMLDialogElement>('[data-slot="dialog"]'),
    ].find((candidate) => candidate.textContent?.includes('Disable Agent'));
    const buttons = [...(confirmation?.querySelectorAll<HTMLButtonElement>('button') ?? [])];

    expect(drawer?.open).toBe(true);
    expect(drawer?.getAttribute('data-placement')).toBe('start');
    expect(drawer?.getAttribute('aria-modal')).toBe('true');
    expect(confirmation?.getAttribute('data-dismissible')).toBe('false');
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    act(() => buttons[1]?.click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps confirmation commands controlled and reports explicit cancel actions', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    renderInDocument(
      <ConfirmationDialog
        cancelLabel="Keep active"
        confirmLabel="Disable"
        description="Confirmation commands remain application-owned."
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        open
        title="Ready confirmation"
      />
    );
    const dialog = document.querySelector<HTMLDialogElement>('[data-slot="dialog"]');
    const buttons = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])];

    act(() => buttons[1]?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => buttons[0]?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false, { reason: 'cancel-action' });
  });
});

function DialogHarness({
  onOpenChange,
}: {
  readonly onOpenChange: (open: false, details: DialogOpenChangeDetails) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-trigger onClick={() => setOpen(true)} type="button">
        Open
      </button>
      <Dialog
        description="Dialog lifecycle example."
        onOpenChange={(nextOpen, details) => {
          onOpenChange(nextOpen, details);
          setOpen(nextOpen);
        }}
        open={open}
        title="Example dialog"
      >
        Body
      </Dialog>
    </>
  );
}

function NestedDialogHarness() {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(true);
  return (
    <>
      <button data-close-outer onClick={() => setOuterOpen(false)} type="button">
        Close outer
      </button>
      <button data-close-inner onClick={() => setInnerOpen(false)} type="button">
        Close inner
      </button>
      <Dialog onOpenChange={() => setOuterOpen(false)} open={outerOpen} title="Outer">
        Outer body
        <Dialog onOpenChange={() => setInnerOpen(false)} open={innerOpen} title="Inner">
          Inner body
        </Dialog>
      </Dialog>
    </>
  );
}

function ControlledNativeCloseHarness({
  onClose,
  onOpenChange,
}: {
  readonly onClose?: () => void;
  readonly onOpenChange: (open: false, details: DialogOpenChangeDetails) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button data-open-native onClick={() => setOpen(true)} type="button">
        Open native close example
      </button>
      <button data-ref-close onClick={() => dialogRef.current?.close()} type="button">
        Close through ref
      </button>
      <Dialog
        onClose={onClose}
        onOpenChange={(nextOpen, details) => {
          onOpenChange(nextOpen, details);
          setOpen(nextOpen);
        }}
        open={open}
        ref={dialogRef}
        title="Native close example"
      >
        <form method="dialog">
          <button data-form-close type="submit">
            Close through form
          </button>
        </form>
      </Dialog>
    </>
  );
}
