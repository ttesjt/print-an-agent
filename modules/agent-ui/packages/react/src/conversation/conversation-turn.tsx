import type {
  ConversationReasoningBlock,
  ConversationToolActivity,
  ConversationUserMessage,
} from '@print-an-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Alert, Badge, Status } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import type { DisclosureContentMaxHeight, DisclosureStateProps } from '../navigation/disclosure.js';
import { AssistantMessage, UserMessage, type ConversationMessagePresentation } from './messages.js';
import { ReasoningBlock, type ReasoningBlockState } from './reasoning-block.js';
import { ToolActivity, type ToolActivityStatusLabels } from './tool-activity.js';

export type ConversationTurnState =
  | 'cancelled'
  | 'cancelling'
  | 'completed'
  | 'committed'
  | 'failed'
  | 'streaming'
  | 'submitting';

export interface ConversationTurnLabels {
  readonly assistant: ReactNode;
  readonly reasoning: (
    modelTurnIndex: number,
    context: Readonly<{ blockCount: number; state: ReasoningBlockState }>
  ) => ReactNode;
  readonly reasoningStates: Readonly<Record<ReasoningBlockState, ReactNode>>;
  readonly states: Readonly<Record<ConversationTurnState, ReactNode>>;
  readonly toolDetails: ReactNode;
  readonly tools: ToolActivityStatusLabels;
  readonly user: ReactNode;
}

type NativeConversationTurnProps = Omit<ComponentPropsWithRef<'li'>, 'children' | 'style'>;

export interface ConversationTurnProps extends NativeConversationTurnProps {
  readonly actions?: ReactNode;
  readonly assistantText?: string;
  readonly failure?: ReactNode;
  readonly formatTimestamp?: (timestamp: string) => ReactNode;
  readonly labels: ConversationTurnLabels;
  readonly messagePresentation?: ConversationMessagePresentation;
  readonly reasoningBlocks?: readonly ConversationReasoningBlock[];
  /** Caller-owned presentation state; no activity is inferred from the interaction status. */
  readonly reasoningDisclosure?: (block: ConversationReasoningBlock) => DisclosureStateProps;
  readonly reasoningMaxContentHeight?: DisclosureContentMaxHeight;
  readonly state: ConversationTurnState;
  readonly style?: never;
  readonly timestamp?: string;
  readonly toolActivities?: readonly ConversationToolActivity[];
  readonly userMessage: ConversationUserMessage;
}

export function ConversationTurn({
  actions,
  assistantText,
  className,
  failure,
  formatTimestamp,
  labels,
  messagePresentation = 'compact',
  reasoningBlocks = [],
  reasoningDisclosure,
  reasoningMaxContentHeight,
  state,
  timestamp,
  toolActivities = [],
  userMessage,
  ...props
}: ConversationTurnProps) {
  const reasoningState: ReasoningBlockState =
    state === 'streaming' ? 'streaming' : state === 'completed' ? 'completed' : 'incomplete';

  return (
    <li
      {...props}
      className={joinStyleHooks('ta-ui-conversation-turn', className)}
      data-slot="conversation-turn"
      data-state={state}
    >
      <UserMessage
        label={labels.user}
        message={userMessage}
        presentation={messagePresentation}
        {...(formatTimestamp === undefined ? {} : { formatTimestamp })}
      />
      <div className="ta-ui-conversation-turn__response" data-slot="conversation-response">
        {state === 'completed' ? null : (
          <header className="ta-ui-conversation-turn__header">
            {state === 'failed' || state === 'cancelled' ? (
              <Badge tone={state === 'failed' ? 'critical' : 'caution'}>
                {labels.states[state]}
              </Badge>
            ) : (
              <Status>{labels.states[state]}</Status>
            )}
          </header>
        )}
        {reasoningBlocks.length === 0 ? null : (
          <div className="ta-ui-conversation-turn__reasoning">
            {reasoningBlocks.map((block) => (
              <ReasoningBlock
                {...reasoningDisclosure?.(block)}
                block={block}
                {...(reasoningMaxContentHeight === undefined
                  ? {}
                  : { contentMaxHeight: reasoningMaxContentHeight })}
                key={block.modelTurnIndex}
                label={labels.reasoning(block.modelTurnIndex, {
                  blockCount: reasoningBlocks.length,
                  state: reasoningState,
                })}
                state={reasoningState}
                stateLabel={labels.reasoningStates[reasoningState]}
              />
            ))}
          </div>
        )}
        {toolActivities.length === 0 ? null : (
          <div className="ta-ui-conversation-turn__tools">
            {toolActivities.map((activity) => (
              <ToolActivity
                activity={activity}
                detailsLabel={labels.toolDetails}
                key={activity.callId}
                presentationStatus={
                  activity.status === 'pending' &&
                  (state === 'cancelled' || state === 'failed' || state === 'committed')
                    ? 'interrupted'
                    : activity.status
                }
                statusLabels={labels.tools}
              />
            ))}
          </div>
        )}
        {assistantText === undefined || assistantText.length === 0 ? null : (
          <AssistantMessage
            label={labels.assistant}
            presentation={messagePresentation}
            text={assistantText}
            {...(formatTimestamp === undefined ? {} : { formatTimestamp })}
            {...(timestamp === undefined ? {} : { timestamp })}
          />
        )}
        {failure === undefined ? null : (
          <Alert className="ta-ui-conversation-turn__failure" tone="critical">
            {failure}
          </Alert>
        )}
        {actions === undefined ? null : (
          <div className="ta-ui-conversation-turn__actions">{actions}</div>
        )}
      </div>
    </li>
  );
}
