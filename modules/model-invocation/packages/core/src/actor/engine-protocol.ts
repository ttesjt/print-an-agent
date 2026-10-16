import {
  ModelInvocationError,
  defineModelInteractionEvent,
  type ModelInteractionEvent,
  type ModelInteractionEventSink,
  type ModelInteractionResult,
  type AssistantModelMessage,
} from '../model/index.js';
import {
  normalizeResultMessage,
  sameAssistantMessage,
  protocolFailure,
} from './result-protocol.js';

interface ActorInteractionProtocol {
  readonly emit: ModelInteractionEventSink;
  close(): void;
  assertValid(): void;
  complete(result: unknown): Promise<ModelInteractionResult>;
}

type InteractionProtocolPhase = 'open' | 'terminal' | 'turn-ended' | 'interaction-ended';

function modelTurnLimitFailure(maxModelTurns: number): ModelInvocationError {
  return new ModelInvocationError(
    'MODEL_TURN_LIMIT_EXCEEDED',
    `Model turn budget ${maxModelTurns} was exhausted before a final response.`
  );
}

function validateMaxModelTurns(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Actor interaction maxModelTurns must be a positive safe integer.'
    );
  }
  return value;
}

export function createActorInteractionProtocol(
  downstream: ModelInteractionEventSink,
  requestedMaxModelTurns: number
): ActorInteractionProtocol {
  const maxModelTurns = validateMaxModelTurns(requestedMaxModelTurns);
  let terminalMessage: AssistantModelMessage | undefined;
  let boundaryFailure: { readonly cause: unknown } | undefined;
  let accepting = true;
  const pendingEvents = new Set<Promise<void>>();
  let emittedEventCount = 0;
  let modelTurnCount = 0;
  let phase: InteractionProtocolPhase = 'open';
  const deferredEvents: ModelInteractionEvent[] = [];

  function lockFailure(cause: unknown): unknown {
    boundaryFailure ??= { cause };
    return boundaryFailure.cause;
  }

  function fail(message: string, cause?: unknown): unknown {
    return lockFailure(protocolFailure(message, cause));
  }

  function startModelTurn(): void {
    modelTurnCount += 1;
    if (modelTurnCount > maxModelTurns) {
      throw lockFailure(modelTurnLimitFailure(maxModelTurns));
    }
  }

  function assertValid(): void {
    if (boundaryFailure !== undefined) throw boundaryFailure.cause;
  }

  const acceptEvent: ModelInteractionEventSink = async (event) => {
    assertValid();
    let normalized: ModelInteractionEvent;
    try {
      normalized = defineModelInteractionEvent(event);
    } catch (cause: unknown) {
      throw fail('Actor Engine interaction emitted an invalid Model interaction event.', cause);
    }
    if (phase === 'interaction-ended') {
      throw fail('Actor Engine interaction emitted an event after interaction-end.');
    }
    if (normalized.type === 'interaction-start' && emittedEventCount !== 0) {
      throw fail('Actor Engine interaction-start must be its first event.');
    }
    if (normalized.type === 'interaction-end') {
      if (phase === 'open') {
        phase = 'interaction-ended';
        emittedEventCount += 1;
        await downstream(normalized);
        return;
      }
      phase = 'interaction-ended';
      deferredEvents.push(normalized);
      emittedEventCount += 1;
      return;
    }
    if (normalized.type === 'assistant-complete') {
      if (phase !== 'open') {
        throw fail('Actor Engine interaction emitted more than one terminal assistant message.');
      }
      if (modelTurnCount === 0) modelTurnCount = 1;
      terminalMessage = normalized.message;
      phase = 'terminal';
      emittedEventCount += 1;
      return;
    }
    if (phase === 'open') {
      if (normalized.type === 'turn-start') startModelTurn();
      emittedEventCount += 1;
      await downstream(normalized);
      return;
    }
    if (normalized.type !== 'turn-end' || phase !== 'terminal') {
      throw fail(
        'Actor Engine terminal assistant message can be followed only by one turn-end and one interaction-end.'
      );
    }
    phase = 'turn-ended';
    deferredEvents.push(normalized);
    emittedEventCount += 1;
  };

  const emit: ModelInteractionEventSink = (event) => {
    let work: Promise<void>;
    if (accepting) work = acceptEvent(event);
    else {
      const cause = fail('Actor Engine emitted an event after its invocation settled.');
      work = Promise.resolve().then(() => {
        throw cause;
      });
    }
    pendingEvents.add(work);
    // Observe the actual returned Promise, including when a custom Engine does not await it.
    void work.then(
      () => {
        pendingEvents.delete(work);
      },
      (cause: unknown) => {
        pendingEvents.delete(work);
        lockFailure(cause);
      }
    );
    return work;
  };

  return Object.freeze({
    emit,
    close: () => {
      accepting = false;
    },
    assertValid,
    async complete(result: unknown): Promise<ModelInteractionResult> {
      accepting = false;
      await Promise.allSettled([...pendingEvents]);
      assertValid();
      const returnedMessage = normalizeResultMessage(result, 'interaction');
      if (terminalMessage === undefined) {
        throw fail('Actor Engine interaction did not emit a terminal assistant message.');
      }
      if (!sameAssistantMessage(terminalMessage, returnedMessage)) {
        throw fail(
          'Actor Engine interaction terminal message does not match its returned assistant message.'
        );
      }
      await downstream(Object.freeze({ type: 'assistant-complete', message: terminalMessage }));
      assertValid();
      for (const event of deferredEvents) {
        await downstream(event);
        assertValid();
      }
      return Object.freeze({ message: terminalMessage });
    },
  });
}
