import type { ConversationReasoningBlock } from '@print-an-agent/ui-contracts';
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

import {
  Disclosure,
  DisclosurePanel,
  DisclosureSummary,
  type DisclosureContentMaxHeight,
  type DisclosurePanelProps,
  type DisclosureStateProps,
} from '../navigation/disclosure.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

export type ReasoningBlockState = 'completed' | 'incomplete' | 'streaming';

type NativeReasoningBlockProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

interface SharedReasoningBlockProps extends NativeReasoningBlockProps {
  readonly block: ConversationReasoningBlock;
  readonly contentMaxHeight?: DisclosureContentMaxHeight;
  readonly label: ReactNode;
  readonly state?: ReasoningBlockState;
  readonly stateLabel: ReactNode;
  readonly style?: never;
}

export type ReasoningBlockProps = SharedReasoningBlockProps & DisclosureStateProps;

export function ReasoningBlock({
  activity,
  block,
  className,
  contentMaxHeight,
  defaultOpen,
  label,
  onOpenChange,
  open,
  state = 'completed',
  stateLabel,
  ...props
}: ReasoningBlockProps) {
  const labelId = useId();
  const panelProps: DisclosurePanelProps =
    contentMaxHeight === undefined ? {} : { 'aria-labelledby': labelId, contentMaxHeight };
  const disclosureState: DisclosureStateProps =
    open === undefined
      ? {
          ...(activity === undefined ? {} : { activity }),
          defaultOpen: defaultOpen ?? false,
          ...(onOpenChange === undefined ? {} : { onOpenChange }),
        }
      : { open, ...(onOpenChange === undefined ? {} : { onOpenChange }) };
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-reasoning-block', className)}
      data-model-turn-index={block.modelTurnIndex}
      data-slot="reasoning-block"
      data-state={state}
    >
      <Disclosure appearance="plain" {...disclosureState}>
        <DisclosureSummary id={labelId}>
          <span>{label}</span>
          {stateLabel === null || stateLabel === undefined ? null : (
            <span className="ta-ui-reasoning-block__state">{stateLabel}</span>
          )}
        </DisclosureSummary>
        <DisclosurePanel {...panelProps}>
          <p className="ta-ui-reasoning-block__content">{block.text}</p>
        </DisclosurePanel>
      </Disclosure>
    </div>
  );
}
