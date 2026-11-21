import {
  AgentConfigError,
  normalizeConfigValue,
  type AgentConfigSnapshot,
  type ConfigValue,
} from '@print-an-agent/base-identity-config/config';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import type { SqliteRow } from './types/record.js';

function requirePositiveInteger(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      `SQLite Config column "${column}" must be a positive safe integer.`
    );
  }
  return value;
}

function requireString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      `SQLite Config column "${column}" must be a string.`
    );
  }
  return value;
}

export function encodeValue(value: ConfigValue, maxValueBytes: number): string {
  const encoded = JSON.stringify(normalizeConfigValue(value));
  if (Buffer.byteLength(encoded, 'utf8') > maxValueBytes) {
    throw new AgentConfigError(
      'CONFIG_SIZE_LIMIT_EXCEEDED',
      `Encoded Agent config exceeds the ${maxValueBytes}-byte storage limit.`
    );
  }
  return encoded;
}

export function decodeSnapshot(row: SqliteRow, maxValueBytes: number): AgentConfigSnapshot {
  const encoded = requireString(row, 'value_json');
  if (Buffer.byteLength(encoded, 'utf8') > maxValueBytes) {
    throw new AgentConfigError(
      'CONFIG_SIZE_LIMIT_EXCEEDED',
      `Stored Agent config exceeds the ${maxValueBytes}-byte storage limit.`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(encoded) as unknown;
  } catch (cause: unknown) {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      'Stored Agent config is not JSON.',
      {
        cause,
      }
    );
  }
  return Object.freeze({
    agentId: parseAgentId(requireString(row, 'agent_id')),
    schemaVersion: requirePositiveInteger(row, 'schema_version'),
    revision: requirePositiveInteger(row, 'revision'),
    value: normalizeConfigValue(value),
  });
}
