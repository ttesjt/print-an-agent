import type { ConversationPage, ConversationTurn } from '@print-an-agent/ui-contracts';

export type ConversationHistoryState =
  | Readonly<{ readonly status: 'idle' }>
  | Readonly<{ readonly status: 'loading'; readonly turns: readonly ConversationTurn[] }>
  | Readonly<{
      readonly error: string;
      readonly status: 'failed';
      readonly turns: readonly ConversationTurn[];
    }>
  | Readonly<{
      readonly hasMore: boolean;
      readonly loadMoreError?: string;
      readonly loadingMore?: boolean;
      readonly nextCursor?: string;
      readonly status: 'ready';
      readonly turns: readonly ConversationTurn[];
    }>;

type ReadyHistoryState = Extract<ConversationHistoryState, { status: 'ready' }>;

export function historyTurns(history: ConversationHistoryState): readonly ConversationTurn[] {
  return history.status === 'idle' ? Object.freeze([]) : history.turns;
}

export function historyFromPage(
  turns: readonly ConversationTurn[],
  nextCursor: string | undefined
): ReadyHistoryState {
  return Object.freeze({
    hasMore: nextCursor !== undefined,
    status: 'ready',
    turns,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
}

export function resolveHistoryRead(
  history: ConversationHistoryState,
  page: ConversationPage,
  initialTurnIds: ReadonlySet<string>
): ReadyHistoryState {
  // A fresh read replaces its starting snapshot, but cannot erase turns committed while it ran.
  const committedDuringRead = historyTurns(history).filter(
    (turn) => !initialTurnIds.has(turn.turnId)
  );
  return historyFromPage(mergeTurns(page.turns, committedDuringRead), page.nextCursor);
}

export function failHistoryRead(
  history: ConversationHistoryState,
  error: string
): ConversationHistoryState {
  return Object.freeze({ error, status: 'failed', turns: historyTurns(history) });
}

export function prependHistoryPage(
  history: ConversationHistoryState,
  page: ConversationPage
): ReadyHistoryState {
  return historyFromPage(mergeTurns(page.turns, historyTurns(history)), page.nextCursor);
}

export function failHistoryPage(
  history: ConversationHistoryState,
  error: string
): ConversationHistoryState {
  if (history.status !== 'ready') return history;
  return Object.freeze({
    ...historyFromPage(history.turns, history.nextCursor),
    loadMoreError: error,
  });
}

export function appendCompletedTurn(
  history: ConversationHistoryState,
  turn: ConversationTurn
): ConversationHistoryState {
  const turns = mergeTurns(historyTurns(history), [turn]);
  return history.status === 'idle'
    ? historyFromPage(turns, undefined)
    : Object.freeze({ ...history, turns });
}

function mergeTurns(
  earlier: readonly ConversationTurn[],
  later: readonly ConversationTurn[]
): readonly ConversationTurn[] {
  const turns = new Map(earlier.map((turn) => [turn.turnId, turn]));
  for (const turn of later) turns.set(turn.turnId, turn);
  return Object.freeze([...turns.values()]);
}
