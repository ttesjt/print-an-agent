import {
  defineActorInvocationPolicy,
  type ActorInvocationPolicy,
} from '@print-an-agent/model-invocation-core';
import {
  defineProviderTransportLivenessPolicy,
  type ProviderTransportLivenessPolicy,
} from '@print-an-agent/model-invocation-core';
import { DEFAULT_REQUEST_POLICY, validateRequestPolicy } from '@print-an-agent/base-request';
import {
  DEFAULT_SESSION_COMPACTION_POLICY,
  validateSessionCompactionPolicy,
} from '@print-an-agent/base-session';
import { AgentBaseStandaloneError } from './errors.js';
import type {
  StandaloneRequestExecutionConfig,
  StandaloneSessionCompactionExecutionConfig,
} from './types.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

const EXECUTION_TIMEOUT_KEYS = Object.freeze(['timeoutMilliseconds']);
const PROVIDER_TRANSPORT_LIVENESS_KEYS = Object.freeze([
  'responseStartTimeoutMilliseconds',
  'streamEventIdleTimeoutMilliseconds',
]);

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isUnknownRecord(value)) {
    throw new AgentBaseStandaloneError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AgentBaseStandaloneError(`${label} must be a plain object.`);
  }
  return value;
}

function assertExactKeys(value: UnknownRecord, allowed: readonly string[], label: string): void {
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !property.enumerable || !('value' in property)) {
      throw new AgentBaseStandaloneError(`${label} must contain enumerable data fields.`);
    }
  }
  const unexpected = Reflect.ownKeys(value).find(
    (key) => typeof key !== 'string' || !allowed.includes(key)
  );
  if (unexpected !== undefined) {
    throw new AgentBaseStandaloneError(
      `${label} contains unsupported field "${String(unexpected)}".`
    );
  }
}

function readTimeoutField(record: UnknownRecord, key: string, label: string): number | null {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw new AgentBaseStandaloneError(`${label} must be an enumerable data field.`);
  }
  const value: unknown = descriptor.value as unknown;
  if (value !== null && typeof value !== 'number') {
    throw new AgentBaseStandaloneError(`${label} must be null or a number.`);
  }
  return value;
}

export function parseStandaloneActorInvocationPolicy(value: unknown): ActorInvocationPolicy {
  if (value === undefined) return defineActorInvocationPolicy(undefined);
  const record = requireRecord(value, 'Standalone main Actor invocationPolicy');
  assertExactKeys(record, EXECUTION_TIMEOUT_KEYS, 'Standalone main Actor invocationPolicy');
  return defineActorInvocationPolicy({
    timeoutMilliseconds: readTimeoutField(
      record,
      'timeoutMilliseconds',
      'Standalone main Actor timeoutMilliseconds'
    ),
  });
}

export function parseStandaloneProviderTransportLivenessPolicy(
  value: unknown
): ProviderTransportLivenessPolicy {
  if (value === undefined) return defineProviderTransportLivenessPolicy(undefined);
  const record = requireRecord(value, 'Standalone provider transportLivenessPolicy');
  assertExactKeys(
    record,
    PROVIDER_TRANSPORT_LIVENESS_KEYS,
    'Standalone provider transportLivenessPolicy'
  );
  return defineProviderTransportLivenessPolicy({
    responseStartTimeoutMilliseconds: readTimeoutField(
      record,
      'responseStartTimeoutMilliseconds',
      'Standalone provider responseStartTimeoutMilliseconds'
    ),
    streamEventIdleTimeoutMilliseconds: readTimeoutField(
      record,
      'streamEventIdleTimeoutMilliseconds',
      'Standalone provider streamEventIdleTimeoutMilliseconds'
    ),
  });
}

export function parseStandaloneRequestExecution(value: unknown): StandaloneRequestExecutionConfig {
  if (value === undefined) {
    return Object.freeze({ timeoutMilliseconds: DEFAULT_REQUEST_POLICY.timeoutMilliseconds });
  }
  const record = requireRecord(value, 'Standalone Request execution');
  assertExactKeys(record, EXECUTION_TIMEOUT_KEYS, 'Standalone Request execution');
  const policy = validateRequestPolicy({
    ...DEFAULT_REQUEST_POLICY,
    timeoutMilliseconds: readTimeoutField(
      record,
      'timeoutMilliseconds',
      'Standalone Request timeoutMilliseconds'
    ),
  });
  return Object.freeze({ timeoutMilliseconds: policy.timeoutMilliseconds });
}

export function parseStandaloneSessionCompactionExecution(
  value: unknown
): StandaloneSessionCompactionExecutionConfig {
  if (value === undefined) {
    return DEFAULT_SESSION_COMPACTION_POLICY;
  }
  const record = requireRecord(value, 'Standalone Session compaction execution');
  assertExactKeys(
    record,
    Object.keys(DEFAULT_SESSION_COMPACTION_POLICY),
    'Standalone Session compaction execution'
  );
  const policy = validateSessionCompactionPolicy({
    ...DEFAULT_SESSION_COMPACTION_POLICY,
    ...record,
    timeoutMilliseconds: readTimeoutField(
      record,
      'timeoutMilliseconds',
      'Standalone Session compaction timeoutMilliseconds'
    ),
  });
  return policy;
}
