import {
  AgentModelError,
  defineAgentLoopEvent,
  defineAssistantModelMessage,
  type AgentLoopEvent,
  type AgentLoopEventSink,
  type AgentLoopResult,
  type AssistantModelMessage,
  type ModelExecutionEvidenceValue,
} from '@ta-agent/base-model';
import { AgentActorError } from './errors.js';
import type { ActorDirectResult } from './engine.js';

type EngineResultKind = 'interaction' | 'direct';

interface ActorInteractionProtocol {
  readonly emit: AgentLoopEventSink;
  assertValid(): void;
  complete(result: unknown): Promise<AgentLoopResult>;
}

type InteractionProtocolPhase = 'open' | 'terminal' | 'turn-ended' | 'interaction-ended';

function protocolFailure(message: string, cause?: unknown): AgentActorError {
  return new AgentActorError(
    'ACTOR_ENGINE_PROTOCOL_INVALID',
    message,
    cause === undefined ? undefined : { cause }
  );
}

function modelTurnLimitFailure(maxModelTurns: number): AgentModelError {
  return new AgentModelError(
    'MODEL_TURN_LIMIT_EXCEEDED',
    `Model turn budget ${maxModelTurns} was exhausted before a final response.`
  );
}

function validateMaxModelTurns(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AgentModelError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Actor interaction maxModelTurns must be a positive safe integer.'
    );
  }
  return value;
}

function readResultMessage(result: unknown, kind: EngineResultKind): unknown {
  const label = kind === 'interaction' ? 'interaction' : 'direct invocation';
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw protocolFailure(`Actor Engine ${label} result must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(result) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw protocolFailure(`Actor Engine ${label} result must be a plain object.`);
  }
  if (Reflect.ownKeys(result).length !== 1 || !Object.hasOwn(result, 'message')) {
    throw protocolFailure(`Actor Engine ${label} result must contain only "message".`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(result, 'message');
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw protocolFailure(`Actor Engine ${label} result message must be an enumerable data field.`);
  }
  return descriptor.value;
}

function normalizeResultMessage(result: unknown, kind: EngineResultKind): AssistantModelMessage {
  try {
    return defineAssistantModelMessage(readResultMessage(result, kind));
  } catch (cause: unknown) {
    if (cause instanceof AgentActorError && cause.code === 'ACTOR_ENGINE_PROTOCOL_INVALID') {
      throw cause;
    }
    const label = kind === 'interaction' ? 'interaction' : 'direct invocation';
    throw protocolFailure(`Actor Engine ${label} returned an invalid assistant message.`, cause);
  }
}

function isEvidenceArray(
  value: ModelExecutionEvidenceValue
): value is readonly ModelExecutionEvidenceValue[] {
  return Array.isArray(value);
}

function sameEvidenceValue(
  left: ModelExecutionEvidenceValue,
  right: ModelExecutionEvidenceValue
): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  if (isEvidenceArray(left) || isEvidenceArray(right)) {
    return (
      isEvidenceArray(left) &&
      isEvidenceArray(right) &&
      left.length === right.length &&
      left.every((value, index) => {
        const rightValue = right[index];
        return rightValue !== undefined && sameEvidenceValue(value, rightValue);
      })
    );
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => {
      const leftValue = left[key];
      const rightValue = right[key];
      return (
        leftValue !== undefined &&
        rightValue !== undefined &&
        Object.hasOwn(right, key) &&
        sameEvidenceValue(leftValue, rightValue)
      );
    })
  );
}

function sameAssistantMessage(left: AssistantModelMessage, right: AssistantModelMessage): boolean {
  if (
    left.role !== right.role ||
    left.text !== right.text ||
    left.stopReason !== right.stopReason ||
    left.timestamp !== right.timestamp ||
    left.usage.inputTokens !== right.usage.inputTokens ||
    left.usage.outputTokens !== right.usage.outputTokens ||
    left.usage.cacheReadTokens !== right.usage.cacheReadTokens ||
    left.usage.cacheWriteTokens !== right.usage.cacheWriteTokens ||
    left.usage.totalTokens !== right.usage.totalTokens ||
    left.provenance.kind !== right.provenance.kind
  ) {
    return false;
  }
  if (left.provenance.kind === 'provider-model') {
    return (
      right.provenance.kind === 'provider-model' &&
      left.provenance.provider === right.provenance.provider &&
      left.provenance.model === right.provenance.model
    );
  }
  return (
    right.provenance.kind === 'engine-defined' &&
    left.provenance.type === right.provenance.type &&
    sameEvidenceValue(left.provenance.evidence, right.provenance.evidence)
  );
}

export function createActorInteractionProtocol(
  downstream: AgentLoopEventSink,
  requestedMaxModelTurns: number
): ActorInteractionProtocol {
  const maxModelTurns = validateMaxModelTurns(requestedMaxModelTurns);
  let terminalMessage: AssistantModelMessage | undefined;
  let boundaryFailure: Error | undefined;
  let emittedEventCount = 0;
  let modelTurnCount = 0;
  let phase: InteractionProtocolPhase = 'open';
  const deferredEvents: AgentLoopEvent[] = [];

  function lockFailure(failure: Error): Error {
    boundaryFailure ??= failure;
    return boundaryFailure;
  }

  function fail(message: string, cause?: unknown): Error {
    return lockFailure(protocolFailure(message, cause));
  }

  function startModelTurn(): void {
    modelTurnCount += 1;
    if (modelTurnCount > maxModelTurns) {
      throw lockFailure(modelTurnLimitFailure(maxModelTurns));
    }
  }

  function assertValid(): void {
    if (boundaryFailure !== undefined) throw boundaryFailure;
  }

  const emit: AgentLoopEventSink = async (event) => {
    if (boundaryFailure !== undefined) throw boundaryFailure;
    let normalized: AgentLoopEvent;
    try {
      normalized = defineAgentLoopEvent(event);
    } catch (cause: unknown) {
      throw fail('Actor Engine interaction emitted an invalid Agent Loop event.', cause);
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

  return Object.freeze({
    emit,
    assertValid,
    async complete(result: unknown): Promise<AgentLoopResult> {
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
      for (const event of deferredEvents) await downstream(event);
      return Object.freeze({ message: terminalMessage });
    },
  });
}

export function normalizeActorDirectResult(result: unknown): ActorDirectResult {
  return Object.freeze({ message: normalizeResultMessage(result, 'direct') });
}
