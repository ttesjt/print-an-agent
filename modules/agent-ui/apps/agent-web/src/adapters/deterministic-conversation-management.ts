import type {
  CompletedConversationTurn,
  ConversationInteractionEvent,
  ConversationInteractionEventConsumer,
  ConversationReasoningBlock,
  ConversationResult,
  ConversationToolActivity,
  ConversationTurn,
  ForkSessionBranchInput,
  ReadConversationInput,
  RewindSessionBranchInput,
  StartConversationInteractionInput,
} from '@print-an-agent/ui-contracts';

import type { ConversationManagementPort } from '../application/ports.js';
import type { DeterministicSessionManagement } from './deterministic-session-management.js';

export type DeterministicConversationManagement = ConversationManagementPort;

export interface DeterministicConversationOptions {
  readonly pace?: (signal: AbortSignal | undefined) => Promise<void>;
}

type BranchHistories = Map<string, ConversationTurn[]>;

const DEFAULT_PAGE_LIMIT = 2;
const INITIAL_TIME = Date.parse('2026-02-01T00:00:00.000Z');

export function createDeterministicConversationManagement(
  sessions: DeterministicSessionManagement,
  options: DeterministicConversationOptions = {}
): DeterministicConversationManagement {
  const histories = initialHistories();
  const pace = options.pace ?? defaultPace;
  let interactionCount = 0;
  let turnCount = 20;
  let logicalClock = 40;
  const now = () => new Date(INITIAL_TIME + logicalClock++ * 1_000).toISOString();

  return Object.freeze({
    forkSessionBranch: (input: ForkSessionBranchInput) => {
      const result = sessions.conversationStore.forkBranch(input);
      if (result.status === 'succeeded') {
        copyBranchHistory(
          histories,
          input.sessionId,
          input.sourceBranchId,
          result.value.affectedBranchId,
          input.throughTurnId
        );
      }
      return Promise.resolve(result);
    },
    readConversation: async (input: ReadConversationInput) => {
      const inspected = await sessions.inspectSession({
        agentId: input.agentId,
        sessionId: input.sessionId,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      return inspected.status === 'failed'
        ? failed('not-found', 'The selected conversation does not exist.')
        : readConversation(histories, input);
    },
    rewindSessionBranch: async (input: RewindSessionBranchInput) => {
      const inspected = await sessions.inspectSessionNavigation(input);
      if (inspected.status === 'failed') return inspected;
      const sourceBranchId = inspected.value.selectedBranchId;
      const result = sessions.conversationStore.rewindBranch(input);
      if (result.status === 'succeeded') {
        copyBranchHistory(
          histories,
          input.sessionId,
          sourceBranchId,
          result.value.affectedBranchId,
          input.throughTurnId
        );
      }
      return result;
    },
    streamInteraction: async (
      input: StartConversationInteractionInput,
      consume: ConversationInteractionEventConsumer
    ) => {
      interactionCount += 1;
      const signal = input.signal;
      let started = false;
      const emit = async (event: ConversationInteractionEvent) => {
        signal?.throwIfAborted();
        await pace(signal);
        signal?.throwIfAborted();
        await consume(event);
      };
      try {
        const target = await resolveTarget(sessions, input, interactionCount);
        await emit({ interactionId: input.interactionId, type: 'interaction-started' });
        started = true;
        if (target.status === 'failed') {
          await emit({
            failure: target.failure,
            interactionId: input.interactionId,
            type: 'failed',
          });
          return;
        }
        const admission = sessions.conversationStore.admitSession({
          agentId: input.agentId,
          ...target.value,
        });
        if (!histories.has(target.value.sessionId))
          histories.set(target.value.sessionId, new Map([[target.value.branchId, []]]));
        signal?.throwIfAborted();
        await consume({ interactionId: input.interactionId, type: 'session-admitted', admission });
        const normalizedMessage = input.message.trim();
        if (normalizedMessage.toLowerCase().includes('fail')) {
          await emit({
            delta: 'I could not complete this request.',
            interactionId: input.interactionId,
            modelTurnIndex: 1,
            type: 'reasoning-delta',
          });
          await emit({
            failure: {
              code: 'interaction-failed',
              message: 'The deterministic model failed before producing a final answer.',
            },
            interactionId: input.interactionId,
            type: 'failed',
          });
          return;
        }

        const scripted = scriptInteraction(input.interactionId, normalizedMessage);
        for (const event of scripted.events) await emit(event);

        turnCount += 1;
        const timestamp = now();
        const turn = completedTurn({
          assistantText: scripted.answer,
          branchId: target.value.branchId,
          reasoningBlocks: scripted.reasoningBlocks,
          timestamp,
          toolActivities: scripted.toolActivities,
          turnId: `turn-${String(turnCount)}`,
          userText: normalizedMessage,
        });
        await pace(signal);
        signal?.throwIfAborted();
        sessions.conversationStore.commitTurn({
          agentId: input.agentId,
          branchId: target.value.branchId,
          sessionId: target.value.sessionId,
          title: sessionTitle(normalizedMessage),
          turnId: turn.turnId,
        });
        appendTurn(histories, target.value.sessionId, target.value.branchId, turn);
        await consume({
          interactionId: input.interactionId,
          sessionId: target.value.sessionId,
          turn,
          type: 'completed',
        });
      } catch (error) {
        if (!signal?.aborted || !started) throw error;
        await consume({ interactionId: input.interactionId, type: 'cancelled' });
      }
    },
  });
}

function readConversation(
  histories: ReadonlyMap<string, BranchHistories>,
  input: ReadConversationInput
): ConversationResult<{
  readonly nextCursor?: string;
  readonly turns: readonly ConversationTurn[];
}> {
  input.signal?.throwIfAborted();
  const branch = histories.get(input.sessionId)?.get(input.branchId);
  if (branch === undefined) return failed('not-found', 'The selected conversation does not exist.');
  const offset = decodeCursor(input.cursor);
  const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
  const end = Math.max(0, branch.length - offset);
  const start = Math.max(0, end - limit);
  return succeeded(
    Object.freeze({
      ...(start > 0 ? { nextCursor: encodeCursor(offset + (end - start)) } : {}),
      turns: Object.freeze(branch.slice(start, end)),
    })
  );
}

async function resolveTarget(
  sessions: DeterministicSessionManagement,
  input: StartConversationInteractionInput,
  interactionCount: number
): Promise<ConversationResult<Readonly<{ branchId: string; sessionId: string }>>> {
  if (input.session === undefined) {
    return succeeded(
      Object.freeze({ branchId: 'main', sessionId: `conversation-${String(interactionCount)}` })
    );
  }
  const [details, navigation] = await Promise.all([
    sessions.inspectSession({ agentId: input.agentId, sessionId: input.session.sessionId }),
    sessions.inspectSessionNavigation({
      agentId: input.agentId,
      sessionId: input.session.sessionId,
    }),
  ]);
  if (details.status === 'failed') {
    return failed('not-found', details.failure.message);
  }
  if (navigation.status === 'failed') {
    return failed('not-found', navigation.failure.message);
  }
  if (details.value.status !== 'active') {
    return failed('unavailable', 'A retired Session cannot accept a new interaction.');
  }
  if (
    navigation.value.revision !== input.session.navigationRevision ||
    navigation.value.selectedBranchId !== input.session.branchId
  ) {
    return failed('session-busy', 'Session navigation changed before the interaction started.');
  }
  return succeeded(
    Object.freeze({ branchId: input.session.branchId, sessionId: input.session.sessionId })
  );
}

function scriptInteraction(interactionId: string, message: string) {
  if (message.toLowerCase().includes('tool')) {
    const pendingTool = toolActivity('lookup-1', 'Evidence lookup', 1, 'pending');
    const completedTool = Object.freeze({
      ...pendingTool,
      details: Object.freeze([
        Object.freeze({ label: 'Source', value: 'Local deterministic fixture' }),
        Object.freeze({ label: 'Matches', value: '2' }),
      ]),
      status: 'success' as const,
      summary: 'Found two relevant records.',
    });
    return Object.freeze({
      answer: 'The tool confirmed the requested result.',
      events: Object.freeze<ConversationInteractionEvent[]>([
        reasoningEvent(interactionId, 1, 'I will inspect the available evidence.'),
        toolEvent(interactionId, pendingTool),
        toolEvent(interactionId, completedTool),
        reasoningEvent(interactionId, 2, 'The returned records support a concise answer.'),
        textEvent(interactionId, 2, 'The tool confirmed '),
        textEvent(interactionId, 2, 'the requested result.'),
      ]),
      reasoningBlocks: Object.freeze([
        reasoningBlock(1, 'I will inspect the available evidence.'),
        reasoningBlock(2, 'The returned records support a concise answer.'),
      ]),
      toolActivities: Object.freeze([completedTool]),
    });
  }
  const reasoningOnly = message.toLowerCase().includes('reasoning only');
  const answer = reasoningOnly ? '' : `Deterministic response to: ${message}`;
  return Object.freeze({
    answer,
    events: Object.freeze<ConversationInteractionEvent[]>([
      reasoningEvent(interactionId, 1, 'I am preparing a bounded response.'),
      ...(reasoningOnly
        ? []
        : [
            textEvent(interactionId, 1, 'Deterministic response to: '),
            textEvent(interactionId, 1, message),
          ]),
    ]),
    reasoningBlocks: Object.freeze([reasoningBlock(1, 'I am preparing a bounded response.')]),
    toolActivities: Object.freeze<ConversationToolActivity[]>([]),
  });
}

function copyBranchHistory(
  histories: Map<string, BranchHistories>,
  sessionId: string,
  sourceBranchId: string,
  targetBranchId: string,
  throughTurnId: string
): void {
  const branches = histories.get(sessionId);
  const source = branches?.get(sourceBranchId);
  const throughIndex = source?.findIndex((turn) => turn.turnId === throughTurnId) ?? -1;
  if (branches === undefined || source === undefined || throughIndex < 0) {
    throw new Error('Deterministic branch history could not be copied.');
  }
  branches.set(targetBranchId, source.slice(0, throughIndex + 1));
}

function appendTurn(
  histories: Map<string, BranchHistories>,
  sessionId: string,
  branchId: string,
  turn: ConversationTurn
): void {
  let branches = histories.get(sessionId);
  if (branches === undefined) {
    branches = new Map();
    histories.set(sessionId, branches);
  }
  const turns = branches.get(branchId) ?? [];
  branches.set(branchId, [...turns, turn]);
}

function initialHistories(): Map<string, BranchHistories> {
  const turn1 = completedTurn({
    assistantText: 'Start with the primary sources and compare their claims.',
    branchId: 'main',
    reasoningBlocks: [reasoningBlock(1, 'I should establish an evidence hierarchy first.')],
    timestamp: timestamp(1),
    toolActivities: [],
    turnId: 'turn-1',
    userText: 'How should I review this evidence?',
  });
  const turn2 = completedTurn({
    assistantText: 'The two sources agree on the central fact.',
    branchId: 'main',
    reasoningBlocks: [reasoningBlock(1, 'I will compare the claims directly.')],
    timestamp: timestamp(2),
    toolActivities: [
      Object.freeze({
        ...toolActivity('lookup-existing', 'Source comparison', 1, 'success'),
        summary: 'Compared two local sources.',
      }),
    ],
    turnId: 'turn-2',
    userText: 'Compare the two strongest sources.',
  });
  const turn3 = completedTurn({
    assistantText: 'The remaining uncertainty is limited to the publication date.',
    branchId: 'main',
    reasoningBlocks: [],
    timestamp: timestamp(3),
    toolActivities: [],
    turnId: 'turn-3',
    userText: 'What remains uncertain?',
  });
  const turn4 = completedTurn({
    assistantText: 'An alternative interpretation gives less weight to the secondary source.',
    branchId: 'alternative',
    reasoningBlocks: [reasoningBlock(1, 'I will use the alternate weighting requested.')],
    timestamp: timestamp(4),
    toolActivities: [],
    turnId: 'turn-4',
    userText: 'Try an alternative interpretation.',
  });
  return new Map([
    [
      'research-session-1',
      new Map([
        ['main', [turn1, turn2, turn3]],
        ['alternative', [turn1, turn2, turn4]],
      ]),
    ],
    ['research-session-2', new Map([['main', simpleTurns('turn-5', 2)]])],
    ['research-session-3', new Map([['main', []]])],
    ['research-session-retired', new Map([['main', simpleTurns('turn-8', 1)]])],
    ['review-session-1', new Map([['main', simpleTurns('turn-9', 3)]])],
  ]);
}

function simpleTurns(firstTurnId: string, count: number): ConversationTurn[] {
  const first = Number(firstTurnId.replace('turn-', ''));
  return Array.from({ length: count }, (_, index) =>
    completedTurn({
      assistantText: `Stored response ${String(index + 1)}.`,
      branchId: 'main',
      reasoningBlocks: [],
      timestamp: timestamp(first + index),
      toolActivities: [],
      turnId: `turn-${String(first + index)}`,
      userText: `Stored request ${String(index + 1)}.`,
    })
  );
}

function completedTurn(input: {
  assistantText: string;
  branchId: string;
  reasoningBlocks: readonly ConversationReasoningBlock[];
  timestamp: string;
  toolActivities: readonly ConversationToolActivity[];
  turnId: string;
  userText: string;
}): CompletedConversationTurn {
  return Object.freeze({
    assistantMessage: Object.freeze({
      reasoningBlocks: Object.freeze([...input.reasoningBlocks]),
      text: input.assistantText,
      timestamp: input.timestamp,
      toolActivities: Object.freeze([...input.toolActivities]),
    }),
    branchId: input.branchId,
    status: 'completed',
    turnId: input.turnId,
    userMessage: Object.freeze({ text: input.userText, timestamp: input.timestamp }),
  });
}

function reasoningBlock(modelTurnIndex: number, text: string): ConversationReasoningBlock {
  return Object.freeze({ modelTurnIndex, text });
}

function toolActivity(
  callId: string,
  toolLabel: string,
  modelTurnIndex: number,
  status: ConversationToolActivity['status']
): ConversationToolActivity {
  return Object.freeze({ callId, details: Object.freeze([]), modelTurnIndex, status, toolLabel });
}

function reasoningEvent(
  interactionId: string,
  modelTurnIndex: number,
  delta: string
): ConversationInteractionEvent {
  return Object.freeze({ delta, interactionId, modelTurnIndex, type: 'reasoning-delta' });
}

function textEvent(
  interactionId: string,
  modelTurnIndex: number,
  delta: string
): ConversationInteractionEvent {
  return Object.freeze({ delta, interactionId, modelTurnIndex, type: 'text-delta' });
}

function toolEvent(
  interactionId: string,
  activity: ConversationToolActivity
): ConversationInteractionEvent {
  return Object.freeze({ activity, interactionId, type: 'tool-activity-updated' });
}

function succeeded<Value>(value: Value): ConversationResult<Value> {
  return Object.freeze({ status: 'succeeded', value });
}

function failed(
  code: 'not-found' | 'session-busy' | 'unavailable',
  message: string
): ConversationResult<never> {
  return Object.freeze({ failure: Object.freeze({ code, message }), status: 'failed' });
}

function encodeCursor(offset: number): string {
  return `cursor-${String(offset)}`;
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^cursor-(\d+)$/u.exec(cursor);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

function sessionTitle(message: string): string {
  return message.length > 48 ? `${message.slice(0, 45)}…` : message;
}

function timestamp(offset: number): string {
  return new Date(INITIAL_TIME + offset * 1_000).toISOString();
}

async function defaultPace(signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 40);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Operation cancelled.', 'AbortError')
      );
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
