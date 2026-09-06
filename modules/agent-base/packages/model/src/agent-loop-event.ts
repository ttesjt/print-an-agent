import { AgentModelError } from './errors.js';
import { defineAssistantModelMessage } from './model-message.js';
import type { AgentLoopEvent } from './types.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

function invalid(message: string): AgentModelError {
  return new AgentModelError('MODEL_RUNTIME_PROTOCOL_INVALID', message);
}

function requirePlainRecord(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid('Agent Loop event must be a plain object.');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid('Agent Loop event must be a plain object.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid('Agent Loop event cannot contain symbol properties.');
  }
  return value as UnknownRecord;
}

function requireDataProperty(record: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw invalid(`Agent Loop event ${key} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function assertExactKeys(record: UnknownRecord, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalid('Agent Loop event contains unsupported or missing fields.');
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw invalid(`Agent Loop event ${name} must be a string.`);
  return value;
}

function requireCount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`Agent Loop event ${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function defineAgentLoopEvent(input: unknown): AgentLoopEvent {
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
  if (type === 'text-delta') {
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
      throw invalid('Agent Loop event Tool status is unsupported.');
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
  throw invalid('Agent Loop event type is unsupported.');
}
