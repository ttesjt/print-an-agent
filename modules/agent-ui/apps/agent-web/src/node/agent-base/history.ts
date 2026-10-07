import { parseAgentId } from '@ta-agent/base-identity';
import {
  AgentSessionError,
  parseSessionBranchId,
  parseSessionId,
  parseTurnId,
  type CompletedSessionTurn,
  type SessionReference,
} from '@ta-agent/base-session';
import type {
  CompletedConversationTurn,
  ConversationPage,
  ConversationTurn,
  ReadConversationInput,
  ConversationToolActivity,
} from '@ta-agent/ui-contracts';
import type { WebBackendServices } from './profile.js';
import { visibleConversationTurns } from './turn-order.js';

export function reference(input: {
  readonly agentId: string;
  readonly sessionId: string;
}): SessionReference {
  return { agentId: parseAgentId(input.agentId), sessionId: parseSessionId(input.sessionId) };
}

export async function completedTurn(
  services: WebBackendServices,
  target: SessionReference,
  turn: CompletedSessionTurn,
  displayedBranchId: string,
  tools: readonly ConversationToolActivity[] = []
): Promise<CompletedConversationTurn> {
  const presentation = await (
    await services.sessionFor(target.agentId)
  ).readTurnPresentation({ ...target, turnId: turn.turnId });
  return {
    status: 'completed',
    branchId: displayedBranchId,
    turnId: turn.turnId,
    userMessage: {
      text: turn.userMessage.text,
      timestamp: new Date(turn.userMessage.timestamp).toISOString(),
    },
    assistantMessage: {
      text: turn.assistantMessage.text,
      timestamp: new Date(turn.assistantMessage.timestamp).toISOString(),
      reasoningBlocks: presentation?.presentation.reasoningBlocks ?? [],
      toolActivities: tools,
    },
  };
}

export async function readWebConversation(
  services: WebBackendServices,
  input: ReadConversationInput
): Promise<ConversationPage> {
  input.signal?.throwIfAborted();
  const target = reference(input);
  const session = await services.sessionFor(target.agentId);
  const snapshot = await session.inspect(target);
  if (snapshot === undefined)
    throw new AgentSessionError('SESSION_NOT_FOUND', 'Conversation does not exist.');
  const branchId = parseSessionBranchId(input.branchId);
  const visible = visibleConversationTurns(snapshot, branchId);
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error('Invalid page limit.');
  const cursor = input.cursor === undefined ? undefined : parseTurnId(input.cursor);
  const end =
    cursor === undefined ? visible.length : visible.findIndex((turn) => turn.turnId === cursor);
  if (end < 0) throw new Error('Invalid conversation cursor.');
  const start = Math.max(0, end - limit);
  const turns: ConversationTurn[] = [];
  for (const turn of visible.slice(start, end)) {
    input.signal?.throwIfAborted();
    if (turn.status === 'completed')
      turns.push(await completedTurn(services, target, turn, branchId));
    else if (turn.status === 'failed')
      turns.push({
        status: 'failed',
        branchId,
        turnId: turn.turnId,
        userMessage: {
          text: turn.userMessage.text,
          timestamp: new Date(turn.userMessage.timestamp).toISOString(),
        },
        failure: { code: 'interaction-failed', message: 'This interaction did not complete.' },
      });
  }
  input.signal?.throwIfAborted();
  const first = visible[start];
  return { turns, ...(start > 0 && first !== undefined ? { nextCursor: first.turnId } : {}) };
}
