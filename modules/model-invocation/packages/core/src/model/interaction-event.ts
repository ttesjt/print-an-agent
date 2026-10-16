import { ModelInvocationError } from './errors.js';
import { defineAssistantModelMessage } from './model-message.js';
import type { ModelInteractionEvent } from './types.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

function invalid(message: string): ModelInvocationError {
  return new ModelInvocationError('MODEL_RUNTIME_PROTOCOL_INVALID', message);
}

function requirePlainRecord(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid('Model interaction event must be a plain object.');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid('Model interaction event must be a plain object.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid('Model interaction event cannot contain symbol properties.');
  }
  return value as UnknownRecord;
}

function requireDataProperty(record: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw invalid(`Model interaction event ${key} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function assertExactKeys(record: UnknownRecord, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalid('Model interaction event contains unsupported or missing fields.');
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw invalid(`Model interaction event ${name} must be a string.`);
  return value;
}

function requireCount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`Model interaction event ${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function defineModelInteractionEvent(input: unknown): ModelInteractionEvent {
  const record = requirePlainRecord(input);
  const type = requireDataProperty(record, 'type');
  if (
    type === 'interaction-start' ||
    type === 'turn-start' ||
    type === 'turn-end' ||
    type === 'interaction-end'
  ) {
    assertExactKeys(record, ['type']);
    return Object.freeze({ type });
  }
  if (type === 'text-delta' || type === 'reasoning-delta') {
    assertExactKeys(record, ['delta', 'type']);
    return Object.freeze({
      type,
      delta: requireString(requireDataProperty(record, 'delta'), 'delta'),
    });
  }
  if (type === 'tool-call-start') {
    assertExactKeys(record, ['callId', 'toolName', 'type']);
    return Object.freeze({
      type,
      callId: requireString(requireDataProperty(record, 'callId'), 'callId'),
      toolName: requireString(requireDataProperty(record, 'toolName'), 'toolName'),
    });
  }
  if (type === 'tool-call-end') {
    assertExactKeys(record, ['callId', 'resultCharacters', 'status', 'toolName', 'type']);
    const status = requireDataProperty(record, 'status');
    if (status !== 'success' && status !== 'error') {
      throw invalid('Model interaction event Tool status is unsupported.');
    }
    return Object.freeze({
      type,
      callId: requireString(requireDataProperty(record, 'callId'), 'callId'),
      toolName: requireString(requireDataProperty(record, 'toolName'), 'toolName'),
      status,
      resultCharacters: requireCount(
        requireDataProperty(record, 'resultCharacters'),
        'resultCharacters'
      ),
    });
  }
  if (type === 'assistant-complete') {
    assertExactKeys(record, ['message', 'type']);
    return Object.freeze({
      type,
      message: defineAssistantModelMessage(requireDataProperty(record, 'message')),
    });
  }
  throw invalid('Model interaction event type is unsupported.');
}
