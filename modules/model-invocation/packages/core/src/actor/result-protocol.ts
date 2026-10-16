import {
  ModelInvocationError,
  defineAssistantModelMessage,
  type AssistantModelMessage,
  type ModelExecutionEvidenceValue,
} from '../model/index.js';
import { ActorError } from './errors.js';
import type { ActorDirectResult } from './engine.js';
type EngineResultKind = 'interaction' | 'direct' | 'stream';
export function protocolFailure(message: string, cause?: unknown): ActorError {
  return new ActorError(
    'ACTOR_ENGINE_PROTOCOL_INVALID',
    message,
    cause === undefined ? undefined : { cause }
  );
}
function readResultMessage(result: unknown, kind: EngineResultKind): unknown {
  const label = kind === 'interaction' ? 'interaction' : `${kind} invocation`;
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

export function normalizeResultMessage(
  result: unknown,
  kind: EngineResultKind
): AssistantModelMessage {
  try {
    return defineAssistantModelMessage(readResultMessage(result, kind));
  } catch (cause: unknown) {
    if (cause instanceof ActorError && cause.code === 'ACTOR_ENGINE_PROTOCOL_INVALID') {
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

export function sameAssistantMessage(
  left: AssistantModelMessage,
  right: AssistantModelMessage
): boolean {
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

export function normalizeActorDirectResult(
  result: unknown,
  maxOutputCharacters: number
): ActorDirectResult {
  const message = normalizeResultMessage(result, 'direct');
  if (message.text.length > maxOutputCharacters) {
    throw new ModelInvocationError(
      'MODEL_OUTPUT_LIMIT_EXCEEDED',
      'Completion exceeded its output character budget.'
    );
  }
  return Object.freeze({ message });
}
