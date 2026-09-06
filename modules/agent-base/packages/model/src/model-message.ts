import { AgentModelError } from './errors.js';
import { defineModelExecutionProvenance } from './model-execution-provenance.js';
import type { AssistantModelMessage, ModelUsage } from './types.js';

const ASSISTANT_MESSAGE_KEYS = Object.freeze([
  'provenance',
  'role',
  'stopReason',
  'text',
  'timestamp',
  'usage',
]);
const USAGE_KEYS = Object.freeze([
  'cacheReadTokens',
  'cacheWriteTokens',
  'inputTokens',
  'outputTokens',
  'totalTokens',
]);

type UnknownRecord = Readonly<Record<string, unknown>>;

function invalid(message: string): AgentModelError {
  return new AgentModelError('MODEL_MESSAGE_INVALID', message);
}

function requirePlainRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid(`${label} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid(`${label} cannot contain symbol properties.`);
  }
  return value as UnknownRecord;
}

function assertExactKeys(record: UnknownRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalid(`${label} has unsupported or missing fields.`);
  }
}

function requireDataProperty(record: UnknownRecord, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw invalid(`${label} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(`${label} must be a string.`);
  return value;
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function defineModelUsage(value: unknown): ModelUsage {
  const record = requirePlainRecord(value, 'Assistant model usage');
  assertExactKeys(record, USAGE_KEYS, 'Assistant model usage');
  return Object.freeze({
    inputTokens: requireNonNegativeSafeInteger(
      requireDataProperty(record, 'inputTokens', 'Usage inputTokens'),
      'Usage inputTokens'
    ),
    outputTokens: requireNonNegativeSafeInteger(
      requireDataProperty(record, 'outputTokens', 'Usage outputTokens'),
      'Usage outputTokens'
    ),
    cacheReadTokens: requireNonNegativeSafeInteger(
      requireDataProperty(record, 'cacheReadTokens', 'Usage cacheReadTokens'),
      'Usage cacheReadTokens'
    ),
    cacheWriteTokens: requireNonNegativeSafeInteger(
      requireDataProperty(record, 'cacheWriteTokens', 'Usage cacheWriteTokens'),
      'Usage cacheWriteTokens'
    ),
    totalTokens: requireNonNegativeSafeInteger(
      requireDataProperty(record, 'totalTokens', 'Usage totalTokens'),
      'Usage totalTokens'
    ),
  });
}

export function defineAssistantModelMessage(input: unknown): AssistantModelMessage {
  const record = requirePlainRecord(input, 'Assistant model message');
  assertExactKeys(record, ASSISTANT_MESSAGE_KEYS, 'Assistant model message');
  if (requireDataProperty(record, 'role', 'Assistant message role') !== 'assistant') {
    throw invalid('Assistant model message role is invalid.');
  }
  const stopReason = requireDataProperty(record, 'stopReason', 'Assistant message stop reason');
  if (stopReason !== 'stop' && stopReason !== 'length') {
    throw invalid('Assistant model message stop reason is invalid.');
  }
  return Object.freeze({
    role: 'assistant',
    text: requireString(
      requireDataProperty(record, 'text', 'Assistant message text'),
      'Assistant message text'
    ),
    provenance: defineModelExecutionProvenance(
      requireDataProperty(record, 'provenance', 'Assistant message provenance')
    ),
    stopReason,
    usage: defineModelUsage(requireDataProperty(record, 'usage', 'Assistant message usage')),
    timestamp: requireNonNegativeSafeInteger(
      requireDataProperty(record, 'timestamp', 'Assistant message timestamp'),
      'Assistant message timestamp'
    ),
  });
}
