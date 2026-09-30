import { ModalSurface, type ModalPublicProps } from './modal-surface.js';

export type DialogProps = ModalPublicProps;

export function Dialog(props: DialogProps) {
  return <ModalSurface {...props} rootClassName="ta-ui-dialog" slotName="dialog" />;
}
