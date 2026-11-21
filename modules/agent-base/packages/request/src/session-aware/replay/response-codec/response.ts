import { parseSessionBranchId, parseSessionId } from '@print-an-agent/base-session';
import {
  defineAssistantModelMessage,
  type AssistantModelMessage,
} from '@print-an-agent/model-invocation-core';
import type { AgentResponse } from '../../types/output.js';
import { parseRequestJournalRequestId } from '../identifiers.js';
import { decodeToolRun } from './tool-run.js';
import { assertKeys, invalidRecord, requireRecord } from './validation.js';
const RESPONSE_SCHEMA_VERSION = 1;

function decodeAssistantMessage(value: unknown): AssistantModelMessage {
  try {
    return defineAssistantModelMessage(value);
  } catch (cause: unknown) {
    throw invalidRecord('Assistant message is invalid.', cause);
  }
}

function decodeResponseValue(value: unknown): AgentResponse {
  const record = requireRecord(value, 'Agent response');
  assertKeys(
    record,
    ['branchId', 'message', 'requestId', 'sessionId', 'toolRun'],
    [],
    'Agent response'
  );
  let sessionId;
  let branchId;
  let requestId;
  try {
    sessionId = parseSessionId(record.sessionId);
    branchId = parseSessionBranchId(record.branchId);
    requestId = parseRequestJournalRequestId(record.requestId);
  } catch (cause: unknown) {
    throw invalidRecord('Agent response request or Session ID is invalid.', cause);
  }
  return Object.freeze({
    requestId,
    sessionId,
    branchId,
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
