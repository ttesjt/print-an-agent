import type {
  ActiveSessionTurn,
  CompletedSessionTurn,
  SessionCompaction,
  SessionTurn,
} from '@print-an-agent/base-session';
import {
  defineAssistantModelMessage,
  type ModelMessage,
} from '@print-an-agent/model-invocation-core';
import { cloneMemoryContext } from './context-message.js';

export function cloneMemoryTurn(turn: ActiveSessionTurn): ActiveSessionTurn;

export function cloneMemoryTurn(turn: CompletedSessionTurn): CompletedSessionTurn;

export function cloneMemoryTurn(turn: SessionTurn): SessionTurn;

export function cloneMemoryTurn(turn: SessionTurn): SessionTurn {
  if (turn.status === 'completed') {
    return Object.freeze({
      ...turn,
      userMessage: Object.freeze({ ...turn.userMessage }),
      assistantMessage: defineAssistantModelMessage(turn.assistantMessage),
    });
  }
  return Object.freeze({ ...turn, userMessage: Object.freeze({ ...turn.userMessage }) });
}

export function cloneMemoryCompaction(compaction: SessionCompaction): SessionCompaction {
  return Object.freeze({ ...compaction, context: cloneMemoryContext(compaction.context) });
}

export function completedMemoryMessages(
  turns: readonly CompletedSessionTurn[]
): readonly ModelMessage[] {
  return Object.freeze(
    turns.flatMap<ModelMessage>((turn) => {
      const clone = cloneMemoryTurn(turn);
      return [clone.userMessage, clone.assistantMessage];
    })
  );
}
