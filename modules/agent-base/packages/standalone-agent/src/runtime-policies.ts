import {
  createDefaultRequestStepOverrides,
  createRequestStepDefinitions,
  DEFAULT_REQUEST_POLICY,
  validateRequestPolicy,
  type RequestPolicy,
} from '@print-an-agent/base-request';
import { mergeStepOverrides, resolveStepRegistry } from '@print-an-agent/workflow-core';
import {
  validateSessionCompactionPolicy,
  bindSessionCompactionTokenCounter,
  type SessionCompactionPolicy,
} from '@print-an-agent/base-session';
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
  return validateSessionCompactionPolicy(config);
}

export function assertStandaloneRuntimeOptions(options: StandaloneRuntimeOptions): void {
  try {
    if (
      typeof options !== 'object' ||
      options === null ||
      Array.isArray(options) ||
      typeof options.readEnvironmentVariable !== 'function'
    ) {
      throw new AgentBaseStandaloneError(
        'Standalone runtime options require a readEnvironmentVariable function.'
      );
    }
    if (Object.prototype.hasOwnProperty.call(options, 'requestPolicy')) {
      throw new AgentBaseStandaloneError(
        'Standalone Request timeout is owned by authoritative configuration; use requestLimits for host-owned non-timeout limits.'
      );
    }
    resolveStandaloneRequestPolicy(
      { timeoutMilliseconds: DEFAULT_REQUEST_POLICY.timeoutMilliseconds },
      options.requestLimits
    );
    if (options.sessionCompactionTokenCounter !== undefined) {
      bindSessionCompactionTokenCounter(options.sessionCompactionTokenCounter);
    }
    if (
      options.resolveTextTokenCounter !== undefined &&
      typeof options.resolveTextTokenCounter !== 'function'
    )
      throw new AgentBaseStandaloneError('Standalone text counter resolver must be a function.');
    resolveStepRegistry(
      createRequestStepDefinitions(),
      mergeStepOverrides(createDefaultRequestStepOverrides(), options.stepOverrides)
    );
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone runtime options are invalid.', { cause });
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
