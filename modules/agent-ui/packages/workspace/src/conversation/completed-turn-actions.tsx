import type { CompletedConversationTurn } from '@print-an-agent/ui-contracts';
import { ConversationTurnActions } from '@print-an-agent/ui-react';

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** Labels, formatting, and capability policy belong to the application, not the public wrapper. */
export function CompletedTurnActions({
  disabled,
  forkPending,
  onFork,
  onRewind,
  turn,
}: Readonly<{
  disabled: boolean;
  forkPending: boolean;
  onFork?: () => void;
  onRewind?: () => void;
  turn: CompletedConversationTurn;
}>) {
  return (
    <ConversationTurnActions
      aria-label="Message actions"
      answeredAt={turn.assistantMessage.timestamp}
      answeredLabel="Answered"
      disabled={disabled}
      forkLabel="Fork from here"
      forkPending={forkPending}
      formatTimestamp={(value) => TIMESTAMP_FORMAT.format(new Date(value))}
      {...(onFork === undefined ? {} : { onFork })}
      {...(onRewind === undefined ? {} : { onRewind })}
      rewindLabel="Rewind to here"
      sentAt={turn.userMessage.timestamp}
      sentLabel="Sent"
      timestampsLabel="Message timestamps"
    />
  );
}
