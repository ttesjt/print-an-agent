import {
  parseToolName,
  type ToolCallId,
  type ToolRunInspection,
  type ToolRunRecord,
} from '@print-an-agent/base-tool';
import { decodeToolDescriptor } from './tool-schema.js';
import {
  assertKeys,
  invalidRecord,
  requireNonNegativeInteger,
  requireRecord,
  requireString,
} from './validation.js';
const TOOL_CALL_ID_MAX_LENGTH = 128;

const TOOL_CALL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;

const TOOL_ERROR_CODE_MAX_LENGTH = 128;

const TOOL_ERROR_CODE_PATTERN = TOOL_CALL_ID_PATTERN;

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

export function decodeToolRun(value: unknown): ToolRunInspection {
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
