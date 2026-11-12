import type { ConversationUserMessage } from '@print-an-agent/ui-contracts';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

type NativeMessageProps = Omit<ComponentPropsWithRef<'section'>, 'children' | 'style'>;

export type ConversationMessagePresentation = 'compact' | 'detailed';

interface ConversationMessageProps extends NativeMessageProps {
  readonly formatTimestamp?: (timestamp: string) => ReactNode;
  readonly label: ReactNode;
  readonly presentation?: ConversationMessagePresentation;
  readonly style?: never;
}

export interface UserMessageProps extends ConversationMessageProps {
  readonly message: ConversationUserMessage;
}

export function UserMessage({
  className,
  formatTimestamp,
  label,
  message,
  presentation = 'compact',
  ...props
}: UserMessageProps) {
  return (
    <section
      {...props}
      className={joinStyleHooks('ta-ui-conversation-message', className)}
      data-role="user"
      data-presentation={presentation}
      data-slot="user-message"
    >
      {presentation === 'compact' ? (
        <span className="ta-ui-visually-hidden">{label}</span>
      ) : (
        <MessageHeader
          label={label}
          timestamp={message.timestamp}
          {...(formatTimestamp === undefined ? {} : { formatTimestamp })}
        />
      )}
      <p className="ta-ui-conversation-message__content">{message.text}</p>
    </section>
  );
}

export interface AssistantMessageProps extends ConversationMessageProps {
  readonly text: string;
  readonly timestamp?: string;
}

export function AssistantMessage({
  className,
  formatTimestamp,
  label,
  presentation = 'compact',
  text,
  timestamp,
  ...props
}: AssistantMessageProps) {
  return (
    <section
      {...props}
      className={joinStyleHooks('ta-ui-conversation-message', className)}
      data-role="assistant"
      data-presentation={presentation}
      data-slot="assistant-message"
    >
      {presentation === 'compact' ? (
        <span className="ta-ui-visually-hidden">{label}</span>
      ) : (
        <MessageHeader
          label={label}
          {...(formatTimestamp === undefined ? {} : { formatTimestamp })}
          {...(timestamp === undefined ? {} : { timestamp })}
        />
      )}
      <p className="ta-ui-conversation-message__content">{text}</p>
    </section>
  );
}

function MessageHeader({
  formatTimestamp,
  label,
  timestamp,
}: Readonly<{
  formatTimestamp?: (timestamp: string) => ReactNode;
  label: ReactNode;
  timestamp?: string;
}>) {
  return (
    <header className="ta-ui-conversation-message__header">
      <strong>{label}</strong>
      {timestamp === undefined ? null : (
        <time dateTime={timestamp}>
          {formatTimestamp === undefined ? timestamp : formatTimestamp(timestamp)}
        </time>
      )}
    </header>
  );
}
