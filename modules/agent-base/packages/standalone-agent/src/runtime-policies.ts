import {
  DEFAULT_REQUEST_POLICY,
  validateRequestPolicy,
  type RequestPolicy,
} from '@ta-agent/base-request';
import {
  DEFAULT_SESSION_COMPACTION_POLICY,
  validateSessionCompactionPolicy,
  type SessionCompactionPolicy,
} from '@ta-agent/base-session';
import { AgentBaseStandaloneError } from './errors.js';
import type {
  StandaloneRequestExecutionConfig,
  StandaloneRuntimeOptions,
  StandaloneSessionCompactionExecutionConfig,
} from './types.js';

const REQUEST_LIMIT_KEYS = Object.freeze([
  'maxMessageCharacters',
  'maxInstructionsCharacters',
  'maxOutputCharacters',
  'maxReasoningCharacters',
  'maxModelTurns',
  'maxPendingInteractionEvents',
] as const);

export function resolveStandaloneRequestPolicy(
  config: StandaloneRequestExecutionConfig,
  limits: StandaloneRuntimeOptions['requestLimits']
): RequestPolicy {
  try {
    const selectedLimits = limits ?? DEFAULT_REQUEST_POLICY;
    if (limits !== undefined) assertClosedRequestLimits(limits);
    return validateRequestPolicy({
      maxMessageCharacters: selectedLimits.maxMessageCharacters,
      maxInstructionsCharacters: selectedLimits.maxInstructionsCharacters,
      maxOutputCharacters: selectedLimits.maxOutputCharacters,
      maxReasoningCharacters: selectedLimits.maxReasoningCharacters,
      maxModelTurns: selectedLimits.maxModelTurns,
      maxPendingInteractionEvents: selectedLimits.maxPendingInteractionEvents,
      timeoutMilliseconds: config.timeoutMilliseconds,
    });
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone Request limits are invalid.', { cause });
  }
}

export function resolveStandaloneSessionCompactionPolicy(
  config: StandaloneSessionCompactionExecutionConfig
): SessionCompactionPolicy {
  return validateSessionCompactionPolicy({
    ...DEFAULT_SESSION_COMPACTION_POLICY,
    timeoutMilliseconds: config.timeoutMilliseconds,
  });
}

export function assertStandaloneRuntimeTimeoutAuthority(options: object): void {
  if (Object.prototype.hasOwnProperty.call(options, 'requestPolicy')) {
    throw new AgentBaseStandaloneError(
      'Standalone Request timeout is owned by durable configuration; use requestLimits for host-owned non-timeout limits.'
    );
  }
}

function assertClosedRequestLimits(value: object): void {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== REQUEST_LIMIT_KEYS.length ||
    keys.some(
      (key) => typeof key !== 'string' || !REQUEST_LIMIT_KEYS.some((candidate) => candidate === key)
    )
  ) {
    throw new AgentBaseStandaloneError(
      'Standalone requestLimits must contain exactly the supported non-timeout Request fields.'
    );
  }
  for (const key of REQUEST_LIMIT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new AgentBaseStandaloneError(
        `Standalone requestLimits field "${key}" must be an enumerable data property.`
      );
    }
  }
}
