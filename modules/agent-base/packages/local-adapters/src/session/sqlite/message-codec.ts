import {
  defineAssistantModelMessage,
  type AssistantModelMessage,
  type ContextModelMessage,
  type UserModelMessage,
} from '@print-an-agent/model-invocation-core';
import { AgentSessionError, MAX_SESSION_COMPACTION_CHARACTERS } from '@print-an-agent/base-session';

const MESSAGE_SCHEMA_VERSION = 1;
const USER_MESSAGE_KEYS = Object.freeze(['role', 'schemaVersion', 'text', 'timestamp']);
const ASSISTANT_MESSAGE_KEYS = Object.freeze([
  'provenance',
  'role',
  'schemaVersion',
  'stopReason',
  'text',
  'timestamp',
  'usage',
]);
const CONTEXT_MESSAGE_KEYS = USER_MESSAGE_KEYS;

type UnknownRecord = Record<string, unknown>;

function invalidRecord(message: string, cause?: unknown): AgentSessionError {
  return new AgentSessionError(
    'SESSION_RECORD_INVALID',
    message,
    cause === undefined ? undefined : { cause }
  );
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (cause: unknown) {
    throw invalidRecord(`Persisted ${label} is not valid JSON.`, cause);
  }
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRecord(`${label} must be a JSON object.`);
  }
  return value as UnknownRecord;
}

function assertExactKeys(record: UnknownRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidRecord(`${label} has unsupported or missing fields.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidRecord(`${label} must be a string.`);
  return value;
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidRecord(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function decodeUserMessageValue(value: unknown): UserModelMessage {
  const record = requireRecord(value, 'Persisted user message');
  assertExactKeys(record, USER_MESSAGE_KEYS, 'Persisted user message');
  if (record.schemaVersion !== MESSAGE_SCHEMA_VERSION || record.role !== 'user') {
    throw invalidRecord('Persisted user message has an unsupported schema version or role.');
  }
  return Object.freeze({
    role: 'user',
    text: requireString(record.text, 'User message text'),
    timestamp: requireNonNegativeSafeInteger(record.timestamp, 'User message timestamp'),
  });
}

function decodeAssistantMessageValue(value: unknown): AssistantModelMessage {
  const record = requireRecord(value, 'Persisted assistant message');
  assertExactKeys(record, ASSISTANT_MESSAGE_KEYS, 'Persisted assistant message');
  if (record.schemaVersion !== MESSAGE_SCHEMA_VERSION || record.role !== 'assistant') {
    throw invalidRecord('Persisted assistant message has an unsupported schema version or role.');
  }
  try {
    return defineAssistantModelMessage({
      role: record.role,
      text: record.text,
      provenance: record.provenance,
      stopReason: record.stopReason,
      usage: record.usage,
      timestamp: record.timestamp,
    });
  } catch (cause: unknown) {
    throw invalidRecord('Persisted assistant message is invalid.', cause);
  }
}

function decodeContextMessageValue(value: unknown): ContextModelMessage {
  const record = requireRecord(value, 'Persisted context message');
  assertExactKeys(record, CONTEXT_MESSAGE_KEYS, 'Persisted context message');
  if (record.schemaVersion !== MESSAGE_SCHEMA_VERSION || record.role !== 'context') {
    throw invalidRecord('Persisted context message has an unsupported schema version or role.');
  }
  const text = requireString(record.text, 'Context message text');
  if (text.length === 0 || text.length > MAX_SESSION_COMPACTION_CHARACTERS) {
    throw invalidRecord(
      `Context message text must contain 1-${MAX_SESSION_COMPACTION_CHARACTERS} characters.`
    );
  }
  return Object.freeze({
    role: 'context',
    text,
    timestamp: requireNonNegativeSafeInteger(record.timestamp, 'Context message timestamp'),
  });
}

export function encodeUserMessage(message: UserModelMessage): string {
  const normalized = decodeUserMessageValue({
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    role: message.role,
    text: message.text,
    timestamp: message.timestamp,
  });
  return JSON.stringify({ schemaVersion: MESSAGE_SCHEMA_VERSION, ...normalized });
}

export function decodeUserMessage(value: string): UserModelMessage {
  return decodeUserMessageValue(parseJson(value, 'user message'));
}

export function encodeAssistantMessage(message: AssistantModelMessage): string {
  let normalized: AssistantModelMessage;
  try {
    normalized = defineAssistantModelMessage(message);
  } catch (cause: unknown) {
    throw invalidRecord('Assistant message is invalid.', cause);
  }
  return JSON.stringify({ schemaVersion: MESSAGE_SCHEMA_VERSION, ...normalized });
}

export function decodeAssistantMessage(value: string): AssistantModelMessage {
  return decodeAssistantMessageValue(parseJson(value, 'assistant message'));
}

export function encodeContextMessage(message: ContextModelMessage): string {
  const normalized = decodeContextMessageValue({
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    role: message.role,
    text: message.text,
    timestamp: message.timestamp,
  });
  return JSON.stringify({ schemaVersion: MESSAGE_SCHEMA_VERSION, ...normalized });
}

export function decodeContextMessage(value: string): ContextModelMessage {
  return decodeContextMessageValue(parseJson(value, 'context message'));
}
