import type {
  ConversationReasoningBlock,
  ConversationToolActivity,
  ConversationUserMessage,
} from '@ta-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { Alert, Badge } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { AssistantMessage, UserMessage } from './messages.js';
import { ReasoningBlock, type ReasoningBlockState } from './reasoning-block.js';
import { ToolActivity, type ToolActivityStatusLabels } from './tool-activity.js';

export type ConversationTurnState =
  | 'cancelled'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'streaming'
  | 'submitting';

export interface ConversationTurnLabels {
  readonly assistant: ReactNode;
  readonly reasoning: (modelTurnIndex: number) => ReactNode;
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
  readonly reasoningBlocks?: readonly ConversationReasoningBlock[];
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
  reasoningBlocks = [],
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
      <article>
        <header className="ta-ui-conversation-turn__header">
          <Badge
            tone={state === 'failed' ? 'critical' : state === 'completed' ? 'positive' : 'neutral'}
          >
            {labels.states[state]}
          </Badge>
          {actions === undefined ? null : (
            <div className="ta-ui-conversation-turn__actions">{actions}</div>
          )}
        </header>
        <UserMessage
          label={labels.user}
          message={userMessage}
          {...(formatTimestamp === undefined ? {} : { formatTimestamp })}
        />
        {reasoningBlocks.length === 0 ? null : (
          <div className="ta-ui-conversation-turn__reasoning">
            {reasoningBlocks.map((block) => (
              <ReasoningBlock
                block={block}
                key={block.modelTurnIndex}
                label={labels.reasoning(block.modelTurnIndex)}
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
                  activity.status === 'pending' && (state === 'cancelled' || state === 'failed')
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
      </article>
    </li>
  );
}
