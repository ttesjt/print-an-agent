import { ModelInvocationError } from '../errors.js';
import { defineModelExecutionProvenance } from '../provenance/index.js';
import {
  readPlainModelRecord,
  assertModelRecordKeys,
  readModelDataField,
} from '../record-validation.js';
import type { AssistantModelMessage, ModelMessage, ModelUsage } from './types.js';

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

function invalid(message: string): ModelInvocationError {
  return new ModelInvocationError('MODEL_MESSAGE_INVALID', message);
}
function requirePlainRecord(value: unknown, label: string): UnknownRecord {
  return readPlainModelRecord(value, label, invalid, 'plain object');
}
function assertExactKeys(record: UnknownRecord, expected: readonly string[], label: string): void {
  assertModelRecordKeys(record, expected, () =>
    invalid(`${label} has unsupported or missing fields.`)
  );
}
function requireDataProperty(record: UnknownRecord, key: string, label: string): unknown {
  return readModelDataField(record, key, () =>
    invalid(`${label} must be an enumerable data property.`)
  );
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

/** Normalizes caller-supplied history without changing message roles or provenance. */
export function defineModelMessage(input: unknown): ModelMessage {
  const record = requirePlainRecord(input, 'Model message');
  const role = requireDataProperty(record, 'role', 'Model message role');
  if (role === 'assistant') return defineAssistantModelMessage(input);
  if (role !== 'user' && role !== 'context') throw invalid('Model message role is invalid.');
  assertExactKeys(record, ['role', 'text', 'timestamp'], 'Model message');
  return Object.freeze({
    role,
    text: requireString(
      requireDataProperty(record, 'text', 'Model message text'),
      'Model message text'
    ),
    timestamp: requireNonNegativeSafeInteger(
      requireDataProperty(record, 'timestamp', 'Model message timestamp'),
      'Model message timestamp'
    ),
  });
}
