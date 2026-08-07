import { defineProviderModelReference, type AssistantModelMessage } from '@ta-agent/base-model';
import { parseSessionId } from '@ta-agent/base-session';
import {
  parseToolName,
  type ToolCallId,
  type ToolDescriptor,
  type ToolObjectSchema,
  type ToolRunInspection,
  type ToolRunRecord,
  type ToolValueSchema,
} from '@ta-agent/base-tool';
import type { AgentResponse } from '../contracts.js';
import { AgentRequestError } from '../errors.js';
import { parseRequestJournalRequestId } from './identifiers.js';

const RESPONSE_SCHEMA_VERSION = 1;
const TOOL_SCHEMA_MAX_DEPTH = 8;
const TOOL_SCHEMA_MAX_PROPERTIES = 64;
const TOOL_DESCRIPTION_MAX_LENGTH = 1_024;
const TOOL_CALL_ID_MAX_LENGTH = 128;
const TOOL_CALL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;
const TOOL_ERROR_CODE_MAX_LENGTH = 128;
const TOOL_ERROR_CODE_PATTERN = TOOL_CALL_ID_PATTERN;

type UnknownRecord = Record<string, unknown>;

function invalidRecord(message: string, cause?: unknown): AgentRequestError {
  return new AgentRequestError(
    'REQUEST_REPLAY_RECORD_INVALID',
    message,
    cause === undefined ? undefined : { cause }
  );
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRecord(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function assertKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw invalidRecord(`${label} has unsupported or missing fields.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidRecord(`${label} must be a string.`);
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidRecord(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidRecord(`${label} must be a finite number.`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireNonNegativeInteger(value, label);
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireFiniteNumber(value, label);
}

function decodeStringSchema(record: UnknownRecord): ToolValueSchema {
  assertKeys(record, ['type'], ['enum', 'maxLength', 'minLength'], 'Tool string schema');
  const minLength = optionalNonNegativeInteger(record.minLength, 'Tool string minLength');
  const maxLength = optionalNonNegativeInteger(record.maxLength, 'Tool string maxLength');
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw invalidRecord('Tool string schema length bounds contradict.');
  }
  let enumValues: readonly string[] | undefined;
  if (record.enum !== undefined) {
    if (!Array.isArray(record.enum) || record.enum.length === 0) {
      throw invalidRecord('Tool string enum must be a non-empty array.');
    }
    const values = record.enum.map((value) => requireString(value, 'Tool string enum value'));
    if (new Set(values).size !== values.length) {
      throw invalidRecord('Tool string enum values must be unique.');
    }
    enumValues = Object.freeze(values);
  }
  return Object.freeze({
    type: 'string',
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(enumValues === undefined ? {} : { enum: enumValues }),
  });
}

function decodeNumericSchema(record: UnknownRecord, type: 'number' | 'integer'): ToolValueSchema {
  assertKeys(record, ['type'], ['maximum', 'minimum'], `Tool ${type} schema`);
  const minimum = optionalFiniteNumber(record.minimum, `Tool ${type} minimum`);
  const maximum = optionalFiniteNumber(record.maximum, `Tool ${type} maximum`);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw invalidRecord(`Tool ${type} schema bounds contradict.`);
  }
  return Object.freeze({
    type,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function decodeObjectSchema(record: UnknownRecord, depth: number): ToolObjectSchema {
  assertKeys(
    record,
    ['additionalProperties', 'properties', 'required', 'type'],
    [],
    'Tool object schema'
  );
  if (record.additionalProperties !== false) {
    throw invalidRecord('Tool object schema must reject additional properties.');
  }
  const propertyRecord = requireRecord(record.properties, 'Tool schema properties');
  const propertyNames = Object.keys(propertyRecord);
  if (propertyNames.length > TOOL_SCHEMA_MAX_PROPERTIES) {
    throw invalidRecord(`Tool object schema exceeds ${TOOL_SCHEMA_MAX_PROPERTIES} properties.`);
  }
  const properties = Object.fromEntries(
    propertyNames.map((name) => [name, decodeToolSchema(propertyRecord[name], depth + 1)])
  );
  if (!Array.isArray(record.required)) {
    throw invalidRecord('Tool object required fields must be an array.');
  }
  const required = record.required.map((value) => requireString(value, 'Required property name'));
  if (
    required.length !== propertyNames.length ||
    new Set(required).size !== required.length ||
    required.some((name) => !Object.hasOwn(properties, name))
  ) {
    throw invalidRecord('Tool object schema must require every property exactly once.');
  }
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    required: Object.freeze(required),
    additionalProperties: false,
  });
}

function decodeToolSchema(value: unknown, depth: number): ToolValueSchema {
  if (depth > TOOL_SCHEMA_MAX_DEPTH) {
    throw invalidRecord(`Tool schema exceeds maximum depth ${TOOL_SCHEMA_MAX_DEPTH}.`);
  }
  const record = requireRecord(value, 'Tool schema');
  if (record.type === 'string') return decodeStringSchema(record);
  if (record.type === 'number' || record.type === 'integer') {
    return decodeNumericSchema(record, record.type);
  }
  if (record.type === 'boolean' || record.type === 'null') {
    assertKeys(record, ['type'], [], `Tool ${record.type} schema`);
    return Object.freeze({ type: record.type });
  }
  if (record.type === 'array') {
    assertKeys(record, ['items', 'type'], ['maxItems'], 'Tool array schema');
    const maxItems = optionalNonNegativeInteger(record.maxItems, 'Tool array maxItems');
    return Object.freeze({
      type: 'array',
      items: decodeToolSchema(record.items, depth + 1),
      ...(maxItems === undefined ? {} : { maxItems }),
    });
  }
  if (record.type === 'object') return decodeObjectSchema(record, depth);
  throw invalidRecord('Tool schema type is unsupported.');
}

function decodeToolDescriptor(value: unknown): ToolDescriptor {
  const record = requireRecord(value, 'Tool descriptor');
  assertKeys(record, ['description', 'name', 'parameters'], [], 'Tool descriptor');
  const description = requireString(record.description, 'Tool description');
  if (description.trim().length === 0 || description.length > TOOL_DESCRIPTION_MAX_LENGTH) {
    throw invalidRecord(
      `Tool description must contain 1-${TOOL_DESCRIPTION_MAX_LENGTH} characters.`
    );
  }
  let name;
  try {
    name = parseToolName(record.name);
  } catch (cause: unknown) {
    throw invalidRecord('Tool descriptor name is invalid.', cause);
  }
  const parameters = decodeToolSchema(record.parameters, 0);
  if (parameters.type !== 'object') {
    throw invalidRecord('Tool descriptor parameters must be an object schema.');
  }
  return Object.freeze({ name, description, parameters });
}

function parseToolCallId(value: unknown): ToolCallId {
  if (
    typeof value !== 'string' ||
    value.length > TOOL_CALL_ID_MAX_LENGTH ||
    !TOOL_CALL_ID_PATTERN.test(value)
  ) {
    throw invalidRecord('Tool run record call ID is invalid.');
  }
  return value as ToolCallId;
}

function decodeToolRunRecord(value: unknown): ToolRunRecord {
  const record = requireRecord(value, 'Tool run record');
  assertKeys(
    record,
    ['callId', 'completedAt', 'resultCharacters', 'startedAt', 'status', 'toolName'],
    ['errorCode'],
    'Tool run record'
  );
  if (
    record.status !== 'success' &&
    record.status !== 'handler-error' &&
    record.status !== 'rejected'
  ) {
    throw invalidRecord('Tool run record status is invalid.');
  }
  let toolName;
  try {
    toolName = parseToolName(record.toolName);
  } catch (cause: unknown) {
    throw invalidRecord('Tool run record name is invalid.', cause);
  }
  const errorCode =
    record.errorCode === undefined
      ? undefined
      : requireString(record.errorCode, 'Tool run error code');
  if (
    (record.status === 'rejected') !== (errorCode !== undefined) ||
    (errorCode !== undefined &&
      (errorCode.length > TOOL_ERROR_CODE_MAX_LENGTH || !TOOL_ERROR_CODE_PATTERN.test(errorCode)))
  ) {
    throw invalidRecord('Tool run error code contradicts its status or is invalid.');
  }
  return Object.freeze({
    callId: parseToolCallId(record.callId),
    toolName,
    status: record.status,
    resultCharacters: requireNonNegativeInteger(
      record.resultCharacters,
      'Tool result character count'
    ),
    startedAt: requireNonNegativeInteger(record.startedAt, 'Tool start timestamp'),
    completedAt: requireNonNegativeInteger(record.completedAt, 'Tool completion timestamp'),
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

function decodeToolRun(value: unknown): ToolRunInspection {
  const record = requireRecord(value, 'Tool run inspection');
  assertKeys(
    record,
    ['effectiveTools', 'records', 'status', 'totalResultCharacters'],
    [],
    'Tool run inspection'
  );
  if (record.status !== 'closed') {
    throw invalidRecord('Persisted Tool run must be closed.');
  }
  if (!Array.isArray(record.effectiveTools) || !Array.isArray(record.records)) {
    throw invalidRecord('Tool run descriptors and records must be arrays.');
  }
  const effectiveTools = Object.freeze(record.effectiveTools.map(decodeToolDescriptor));
  const records = Object.freeze(record.records.map(decodeToolRunRecord));
  if (new Set(effectiveTools.map((tool) => tool.name)).size !== effectiveTools.length) {
    throw invalidRecord('Tool run contains duplicate effective tool names.');
  }
  if (new Set(records.map((entry) => entry.callId)).size !== records.length) {
    throw invalidRecord('Tool run contains duplicate call IDs.');
  }
  const totalResultCharacters = requireNonNegativeInteger(
    record.totalResultCharacters,
    'Tool run total result characters'
  );
  if (
    records.reduce((total, current) => total + current.resultCharacters, 0) !==
    totalResultCharacters
  ) {
    throw invalidRecord('Tool run total result characters do not match its records.');
  }
  return Object.freeze({ status: 'closed', effectiveTools, records, totalResultCharacters });
}

function decodeAssistantMessage(value: unknown): AssistantModelMessage {
  const record = requireRecord(value, 'Assistant message');
  assertKeys(
    record,
    ['model', 'provider', 'role', 'stopReason', 'text', 'timestamp', 'usage'],
    [],
    'Assistant message'
  );
  if (
    record.role !== 'assistant' ||
    (record.stopReason !== 'stop' && record.stopReason !== 'length')
  ) {
    throw invalidRecord('Assistant message role or stop reason is invalid.');
  }
  const usage = requireRecord(record.usage, 'Assistant usage');
  assertKeys(
    usage,
    ['cacheReadTokens', 'cacheWriteTokens', 'inputTokens', 'outputTokens', 'totalTokens'],
    [],
    'Assistant usage'
  );
  let reference;
  try {
    reference = defineProviderModelReference({
      provider: requireString(record.provider, 'Assistant provider'),
      model: requireString(record.model, 'Assistant model'),
    });
  } catch (cause: unknown) {
    throw invalidRecord('Assistant model reference is invalid.', cause);
  }
  return Object.freeze({
    role: 'assistant',
    text: requireString(record.text, 'Assistant text'),
    provider: reference.provider,
    model: reference.model,
    stopReason: record.stopReason,
    usage: Object.freeze({
      inputTokens: requireNonNegativeInteger(usage.inputTokens, 'Usage inputTokens'),
      outputTokens: requireNonNegativeInteger(usage.outputTokens, 'Usage outputTokens'),
      cacheReadTokens: requireNonNegativeInteger(usage.cacheReadTokens, 'Usage cacheReadTokens'),
      cacheWriteTokens: requireNonNegativeInteger(usage.cacheWriteTokens, 'Usage cacheWriteTokens'),
      totalTokens: requireNonNegativeInteger(usage.totalTokens, 'Usage totalTokens'),
    }),
    timestamp: requireNonNegativeInteger(record.timestamp, 'Assistant timestamp'),
  });
}

function decodeResponseValue(value: unknown): AgentResponse {
  const record = requireRecord(value, 'Agent response');
  assertKeys(record, ['message', 'requestId', 'sessionId', 'toolRun'], [], 'Agent response');
  let sessionId;
  let requestId;
  try {
    sessionId = parseSessionId(record.sessionId);
    requestId = parseRequestJournalRequestId(record.requestId);
  } catch (cause: unknown) {
    throw invalidRecord('Agent response request or Session ID is invalid.', cause);
  }
  return Object.freeze({
    requestId,
    sessionId,
    message: decodeAssistantMessage(record.message),
    toolRun: decodeToolRun(record.toolRun),
  });
}

export function encodeAgentResponse(response: AgentResponse): string {
  let encoded: string;
  try {
    encoded = JSON.stringify({ schemaVersion: RESPONSE_SCHEMA_VERSION, response });
  } catch (cause: unknown) {
    throw invalidRecord('Agent response is not JSON-compatible.', cause);
  }
  decodeAgentResponse(encoded);
  return encoded;
}

export function decodeAgentResponse(value: string): AgentResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (cause: unknown) {
    throw invalidRecord('Persisted Agent response is not valid JSON.', cause);
  }
  const envelope = requireRecord(parsed, 'Agent response envelope');
  assertKeys(envelope, ['response', 'schemaVersion'], [], 'Agent response envelope');
  if (envelope.schemaVersion !== RESPONSE_SCHEMA_VERSION) {
    throw invalidRecord('Agent response envelope version is unsupported.');
  }
  return decodeResponseValue(envelope.response);
}
