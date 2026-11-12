import type {
  ConversationInteractionEvent,
  ConversationSessionAdmission,
  StartConversationInteractionInput,
} from '@print-an-agent/ui-contracts';

import type { ConversationManagementPort } from '../application/ports.js';
import {
  ConversationStreamProtocolError,
  failInteractionProtocol,
  isTerminalInteraction,
  reduceInteractionEvent,
  type ActiveInteractionState,
} from './interaction-state.js';

/** Stream validation owns terminal authority; the controller owns where presentation is stored. */
export async function executeConversationInteraction({
  initial,
  isCurrent,
  management,
  onAdmission,
  onProgress,
  request,
}: Readonly<{
  initial: ActiveInteractionState;
  isCurrent: () => boolean;
  management: ConversationManagementPort;
  onAdmission: (admission: ConversationSessionAdmission, state: ActiveInteractionState) => void;
  onProgress: (state: ActiveInteractionState) => void;
  request: StartConversationInteractionInput;
}>): Promise<ActiveInteractionState | undefined> {
  // Bind validation to the actual request, never to identity supplied by a stream event.
  let state: ActiveInteractionState = Object.freeze({
    ...initial,
    requestedSession: request.session,
  });
  let protocolFailure: ConversationStreamProtocolError | undefined;
  try {
    await management.streamInteraction(request, (event) => {
      if (!isCurrent()) return Promise.resolve();
      if (protocolFailure !== undefined) return Promise.reject(protocolFailure);
      try {
        requireEventTarget(event, request);
        state = reduceInteractionEvent(state, event);
        if (event.type === 'session-admitted') onAdmission(event.admission, state);
        // Completion is provisional until the whole port invocation validates and settles.
        if (state.status !== 'completed' && state.status !== 'committed') onProgress(state);
        return Promise.resolve();
      } catch (error) {
        protocolFailure =
          error instanceof ConversationStreamProtocolError
            ? error
            : new ConversationStreamProtocolError('Interaction event is malformed.');
        return Promise.reject(protocolFailure);
      }
    });
    if (!isCurrent()) return undefined;
    if (protocolFailure !== undefined) throw protocolFailure;
    if (!isTerminalInteraction(state)) {
      state = failInteractionProtocol(state, 'Interaction stream ended without a terminal event.');
      onProgress(state);
    }
  } catch (error) {
    if (!isCurrent()) return undefined;
    if (protocolFailure !== undefined) {
      state = failInteractionProtocol(state, protocolFailure.message);
    } else if (state.status === 'completed' || state.status === 'committed') {
      state = failInteractionProtocol(
        state,
        'Interaction transport failed after its completion event.'
      );
    } else if (!isTerminalInteraction(state)) {
      state = request.signal?.aborted
        ? reduceInteractionEvent(state, { interactionId: request.interactionId, type: 'cancelled' })
        : failInteractionProtocol(
            state,
            error instanceof Error ? error.message : 'The interaction could not be completed.'
          );
    }
    onProgress(state);
  }
  return state;
}

function requireEventTarget(
  event: ConversationInteractionEvent,
  request: StartConversationInteractionInput
): void {
  const target = request.session;
  if (
    event.type === 'committed' &&
    target !== undefined &&
    (event.receipt.sessionId !== target.sessionId || event.receipt.branchId !== target.branchId)
  )
    throw new ConversationStreamProtocolError(
      'Commit receipt does not match the requested Session branch.'
    );
  if (
    event.type === 'session-admitted' &&
    (event.admission.details.agentId !== request.agentId ||
      (target !== undefined &&
        (event.admission.details.sessionId !== target.sessionId ||
          event.admission.navigation.selectedBranchId !== target.branchId ||
          event.admission.navigation.revision !== target.navigationRevision)))
  )
    throw new ConversationStreamProtocolError(
      'Session admission does not match the requested conversation target.'
    );
  if (
    event.type === 'completed' &&
    target !== undefined &&
    (event.sessionId !== target.sessionId || event.turn.branchId !== target.branchId)
  )
    throw new ConversationStreamProtocolError(
      'Completed interaction target does not match the requested Session branch.'
    );
}
