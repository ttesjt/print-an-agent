import { ModalSurface, type ModalPublicProps } from './modal-surface.js';

export type DrawerPlacement = 'end' | 'start';

export interface DrawerProps extends ModalPublicProps {
  readonly placement?: DrawerPlacement;
}

export function Drawer({ placement = 'end', ...props }: DrawerProps) {
  return (
    <ModalSurface {...props} placement={placement} rootClassName="ta-ui-drawer" slotName="drawer" />
  );
}
