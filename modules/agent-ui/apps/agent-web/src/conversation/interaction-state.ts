import type {
  CompletedConversationTurn,
  ConversationFailure,
  ConversationInteractionEvent,
  ConversationReasoningBlock,
  ConversationSessionAdmission,
  ConversationToolActivity,
  ConversationUserMessage,
} from '@ta-agent/ui-contracts';

interface CapturedReasoningBlock {
  readonly chunks: readonly string[];
  readonly modelTurnIndex: number;
}

interface InteractionStateBase {
  readonly admission: ConversationSessionAdmission | undefined;
  readonly assistantTextChunks: readonly string[];
  readonly highestModelTurnIndex: number;
  readonly interactionId: string;
  readonly reasoningBlocks: readonly CapturedReasoningBlock[];
  readonly started: boolean;
  readonly toolActivities: readonly ConversationToolActivity[];
  readonly userMessage: ConversationUserMessage;
}

export type ActiveInteractionState =
  | Readonly<InteractionStateBase & { readonly status: 'cancelling' | 'streaming' | 'submitting' }>
  | Readonly<InteractionStateBase & { readonly status: 'cancelled' }>
  | Readonly<
      InteractionStateBase & { readonly failure: ConversationFailure; readonly status: 'failed' }
    >
  | Readonly<
      InteractionStateBase & {
        readonly sessionId: string;
        readonly status: 'completed';
        readonly turn: CompletedConversationTurn;
      }
    >;

export class ConversationStreamProtocolError extends Error {
  readonly code = 'invalid-stream';

  constructor(message: string) {
    super(message);
    this.name = 'ConversationStreamProtocolError';
  }
}

export function createSubmittingInteraction(input: {
  readonly interactionId: string;
  readonly message: string;
  readonly timestamp: string;
}): ActiveInteractionState {
  return Object.freeze({
    admission: undefined,
    assistantTextChunks: Object.freeze([]),
    highestModelTurnIndex: 0,
    interactionId: input.interactionId,
    reasoningBlocks: Object.freeze([]),
    started: false,
    status: 'submitting',
    toolActivities: Object.freeze([]),
    userMessage: Object.freeze({ text: input.message, timestamp: input.timestamp }),
  });
}

export function markInteractionCancelling(state: ActiveInteractionState): ActiveInteractionState {
  if (isTerminalInteraction(state)) return state;
  return Object.freeze({ ...state, status: 'cancelling' });
}

export function reduceInteractionEvent(
  state: ActiveInteractionState,
  event: ConversationInteractionEvent
): ActiveInteractionState {
  if (event.interactionId !== state.interactionId) {
    throw new ConversationStreamProtocolError(
      'Interaction event identity does not match the active run.'
    );
  }
  if (isTerminalInteraction(state)) {
    throw new ConversationStreamProtocolError(
      'Interaction event arrived after the terminal event.'
    );
  }

  if (event.type === 'interaction-started') {
    if (state.started || (state.status !== 'submitting' && state.status !== 'cancelling')) {
      throw new ConversationStreamProtocolError('Interaction started more than once.');
    }
    return Object.freeze({
      ...state,
      started: true,
      status: state.status === 'cancelling' ? 'cancelling' : 'streaming',
    });
  }

  if (event.type === 'failed') {
    return Object.freeze({ ...state, failure: event.failure, status: 'failed' });
  }

  if (event.type === 'cancelled') {
    return Object.freeze({ ...state, status: 'cancelled' });
  }

  if (!state.started) {
    throw new ConversationStreamProtocolError(
      'Interaction content arrived before interaction-started.'
    );
  }

  if (event.type === 'session-admitted') {
    const { details, navigation } = event.admission;
    if (
      state.admission !== undefined ||
      state.highestModelTurnIndex !== 0 ||
      details.status !== 'active' ||
      details.agentId !== navigation.agentId ||
      details.sessionId !== navigation.sessionId ||
      details.selectedBranchId !== navigation.selectedBranchId ||
      details.navigationRevision !== navigation.revision ||
      details.branchCount !== navigation.branches.length ||
      !navigation.branches.some((branch) => branch.branchId === navigation.selectedBranchId)
    ) {
      throw new ConversationStreamProtocolError(
        'Session admission is inconsistent or out of order.'
      );
    }
    return Object.freeze({ ...state, admission: event.admission });
  }

  if (event.type === 'reasoning-delta') {
    requireDelta(event.delta, 'Reasoning');
    const highestModelTurnIndex = requireModelTurnOrder(
      state.highestModelTurnIndex,
      event.modelTurnIndex
    );
    return Object.freeze({
      ...state,
      highestModelTurnIndex,
      reasoningBlocks: appendReasoningDelta(
        state.reasoningBlocks,
        event.modelTurnIndex,
        event.delta
      ),
    });
  }

  if (event.type === 'text-delta') {
    requireDelta(event.delta, 'Text');
    return Object.freeze({
      ...state,
      assistantTextChunks: Object.freeze([...state.assistantTextChunks, event.delta]),
      highestModelTurnIndex: requireModelTurnOrder(
        state.highestModelTurnIndex,
        event.modelTurnIndex
      ),
    });
  }

  if (event.type === 'tool-activity-updated') {
    const highestModelTurnIndex = requireModelTurnOrder(
      state.highestModelTurnIndex,
      event.activity.modelTurnIndex
    );
    return Object.freeze({
      ...state,
      highestModelTurnIndex,
      toolActivities: updateToolActivity(state.toolActivities, event.activity),
    });
  }

  if (event.type === 'completed') {
    if (
      state.admission !== undefined &&
      (event.sessionId !== state.admission.details.sessionId ||
        event.turn.branchId !== state.admission.navigation.selectedBranchId)
    ) {
      throw new ConversationStreamProtocolError(
        'Completed interaction does not match its admitted Session.'
      );
    }
    if (state.toolActivities.some((activity) => activity.status === 'pending')) {
      throw new ConversationStreamProtocolError(
        'Interaction completed with a pending tool activity.'
      );
    }
    if (event.turn.status !== 'completed') {
      throw new ConversationStreamProtocolError(
        'Completed interaction must contain a completed turn.'
      );
    }
    requireCanonicalTurnMatchesStream(state, event.turn);
    return Object.freeze({
      ...state,
      sessionId: event.sessionId,
      status: 'completed',
      turn: event.turn,
    });
  }

  throw new ConversationStreamProtocolError('Interaction event type is not supported.');
}

export function failInteractionProtocol(
  state: ActiveInteractionState,
  message: string
): ActiveInteractionState {
  return Object.freeze({
    ...state,
    failure: Object.freeze({ code: 'invalid-stream', message }),
    status: 'failed',
  });
}

export function isTerminalInteraction(state: ActiveInteractionState): boolean {
  return state.status === 'cancelled' || state.status === 'completed' || state.status === 'failed';
}

export function interactionAssistantText(state: ActiveInteractionState): string {
  return state.assistantTextChunks.join('');
}

export function interactionReasoningBlocks(
  state: ActiveInteractionState
): readonly ConversationReasoningBlock[] {
  return Object.freeze(
    state.reasoningBlocks.map((block) =>
      Object.freeze({ modelTurnIndex: block.modelTurnIndex, text: block.chunks.join('') })
    )
  );
}

function appendReasoningDelta(
  blocks: readonly CapturedReasoningBlock[],
  modelTurnIndex: number,
  delta: string
): readonly CapturedReasoningBlock[] {
  const last = blocks.at(-1);
  if (last?.modelTurnIndex === modelTurnIndex) {
    return Object.freeze([
      ...blocks.slice(0, -1),
      Object.freeze({ ...last, chunks: Object.freeze([...last.chunks, delta]) }),
    ]);
  }
  return Object.freeze([
    ...blocks,
    Object.freeze({ chunks: Object.freeze([delta]), modelTurnIndex }),
  ]);
}

function updateToolActivity(
  activities: readonly ConversationToolActivity[],
  next: ConversationToolActivity
): readonly ConversationToolActivity[] {
  const index = activities.findIndex((activity) => activity.callId === next.callId);
  if (index < 0) {
    if (next.status !== 'pending') {
      throw new ConversationStreamProtocolError('Tool activity must begin in the pending state.');
    }
    return Object.freeze([...activities, next]);
  }
  const current = activities[index];
  if (current === undefined) {
    throw new ConversationStreamProtocolError('Tool activity state could not be resolved.');
  }
  if (
    current.status !== 'pending' ||
    next.status === 'pending' ||
    current.modelTurnIndex !== next.modelTurnIndex ||
    current.toolLabel !== next.toolLabel
  ) {
    throw new ConversationStreamProtocolError('Tool activity transition is invalid.');
  }
  return Object.freeze(
    activities.map((activity, candidate) => (candidate === index ? next : activity))
  );
}

function requireCanonicalTurnMatchesStream(
  state: ActiveInteractionState,
  turn: CompletedConversationTurn
): void {
  const assistant = turn.assistantMessage;
  if (
    turn.userMessage.text !== state.userMessage.text ||
    assistant.text !== interactionAssistantText(state) ||
    !sameReasoningBlocks(assistant.reasoningBlocks, interactionReasoningBlocks(state)) ||
    !sameToolActivities(assistant.toolActivities, state.toolActivities)
  ) {
    throw new ConversationStreamProtocolError(
      'Completed interaction does not match the accepted stream presentation.'
    );
  }
}

function sameReasoningBlocks(
  left: readonly ConversationReasoningBlock[],
  right: readonly ConversationReasoningBlock[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (block, index) =>
        block.modelTurnIndex === right[index]?.modelTurnIndex && block.text === right[index]?.text
    )
  );
}

function sameToolActivities(
  left: readonly ConversationToolActivity[],
  right: readonly ConversationToolActivity[]
): boolean {
  return (
    left.length === right.length &&
    left.every((activity, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        activity.callId === candidate.callId &&
        activity.modelTurnIndex === candidate.modelTurnIndex &&
        activity.status === candidate.status &&
        activity.summary === candidate.summary &&
        activity.toolLabel === candidate.toolLabel &&
        activity.details.length === candidate.details.length &&
        activity.details.every(
          (detail, detailIndex) =>
            detail.label === candidate.details[detailIndex]?.label &&
            detail.value === candidate.details[detailIndex]?.value
        )
      );
    })
  );
}

function requireModelTurnOrder(current: number, next: number): number {
  if (!Number.isSafeInteger(next) || next <= 0 || next < current) {
    throw new ConversationStreamProtocolError('Model turn indexes must be positive and monotonic.');
  }
  return Math.max(current, next);
}

function requireDelta(delta: string, label: string): void {
  if (delta.length === 0) {
    throw new ConversationStreamProtocolError(`${label} delta must not be empty.`);
  }
}
