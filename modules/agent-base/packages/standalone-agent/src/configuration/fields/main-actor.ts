import { defineAgentActor } from '@print-an-agent/agent-actor';
import {
  defineActorInvocationPolicy,
  type ActorInvocationConfig,
  type ActorInvocationPolicy,
} from '@print-an-agent/model-invocation-core';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandaloneMainActorConfig } from '../types/main-actor.js';
import type { UnknownRecord } from '../types/validation.js';
import {
  assertDataFields,
  assertExactKeys,
  EXECUTION_TIMEOUT_KEYS,
  readOptionalDataField,
  readTimeoutField,
  requireRecord,
} from '../validation.js';

export function parseStandaloneActorInvocationPolicy(value: unknown): ActorInvocationPolicy {
  if (value === undefined) return defineActorInvocationPolicy(undefined);
  const record = requireRecord(value, 'Standalone main Actor invocationPolicy');
  assertDataFields(record, 'Standalone main Actor invocationPolicy');
  assertExactKeys(record, EXECUTION_TIMEOUT_KEYS, 'Standalone main Actor invocationPolicy');
  return defineActorInvocationPolicy({
    timeoutMilliseconds: readTimeoutField(
      record,
      'timeoutMilliseconds',
      'Standalone main Actor timeoutMilliseconds'
    ),
  });
}

const MAIN_ACTOR_KEYS = Object.freeze(['instructions', 'invocationConfig', 'invocationPolicy']);

const INVOCATION_CONFIG_KEYS = Object.freeze(['temperature', 'maxOutputTokens']);

export function parseInvocationConfig(value: unknown): ActorInvocationConfig {
  if (value === undefined) return Object.freeze({});
  const record = requireRecord(value, 'Standalone main Actor invocation config');
  assertExactKeys(record, INVOCATION_CONFIG_KEYS, 'Standalone main Actor invocation config');
  const temperature = record.temperature;
  const maxOutputTokens = record.maxOutputTokens;
  if (
    temperature !== undefined &&
    (typeof temperature !== 'number' || !Number.isFinite(temperature))
  ) {
    throw new AgentBaseStandaloneError('Standalone Actor temperature must be a finite number.');
  }
  if (maxOutputTokens !== undefined && typeof maxOutputTokens !== 'number') {
    throw new AgentBaseStandaloneError('Standalone Actor maxOutputTokens must be a number.');
  }
  const definition = defineAgentActor({
    id: 'main',
    engineId: 'standalone-config-validation',
    invocationConfig: {
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    },
  });
  return definition.invocationConfig;
}

export function parseMainActor(value: unknown): StandaloneMainActorConfig {
  const record: UnknownRecord =
    value === undefined ? Object.freeze({}) : requireRecord(value, 'Standalone main Actor');
  assertExactKeys(record, MAIN_ACTOR_KEYS, 'Standalone main Actor');
  const instructions = readOptionalDataField(
    record,
    'instructions',
    'Standalone main Actor instructions'
  );
  if (instructions !== undefined && typeof instructions !== 'string') {
    throw new AgentBaseStandaloneError('Standalone main Actor instructions must be a string.');
  }
  const definition = defineAgentActor({
    id: 'main',
    engineId: 'standalone-config-validation',
    ...(instructions === undefined ? {} : { instructions }),
    invocationConfig: parseInvocationConfig(
      readOptionalDataField(record, 'invocationConfig', 'Standalone main Actor invocationConfig')
    ),
    invocationPolicy: parseStandaloneActorInvocationPolicy(
      readOptionalDataField(record, 'invocationPolicy', 'Standalone main Actor invocationPolicy')
    ),
  });
  return Object.freeze({
    ...(definition.instructions === undefined ? {} : { instructions: definition.instructions }),
    invocationConfig: definition.invocationConfig,
    invocationPolicy: definition.invocationPolicy,
  });
}
