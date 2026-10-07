import type { ConversationReasoningBlock } from '@ta-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Disclosure, DisclosurePanel, DisclosureSummary } from '../navigation/disclosure.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

export type ReasoningBlockState = 'completed' | 'incomplete' | 'streaming';

type NativeReasoningBlockProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style'>;

export interface ReasoningBlockProps extends NativeReasoningBlockProps {
  readonly block: ConversationReasoningBlock;
  readonly defaultOpen?: boolean;
  readonly label: ReactNode;
  readonly state?: ReasoningBlockState;
  readonly stateLabel: ReactNode;
  readonly style?: never;
}

export function ReasoningBlock({
  block,
  className,
  defaultOpen,
  label,
  state = 'completed',
  stateLabel,
  ...props
}: ReasoningBlockProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-reasoning-block', className)}
      data-model-turn-index={block.modelTurnIndex}
      data-slot="reasoning-block"
      data-state={state}
    >
      <Disclosure defaultOpen={defaultOpen ?? state === 'streaming'}>
        <DisclosureSummary>
          <span>{label}</span>
          <span className="ta-ui-reasoning-block__state">{stateLabel}</span>
        </DisclosureSummary>
        <DisclosurePanel>
          <p className="ta-ui-reasoning-block__content">{block.text}</p>
        </DisclosurePanel>
      </Disclosure>
    </div>
  );
}
