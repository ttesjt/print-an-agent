import { defineProviderConfig } from '@print-an-agent/base-composition';
import {
  defineProviderTransportLivenessPolicy,
  type ProviderTransportLivenessPolicy,
} from '@print-an-agent/model-invocation-core';
import { defineTextTokenCounterConfig } from '@print-an-agent/model-invocation-token-counters';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandaloneProviderConfig } from '../types/provider.js';
import {
  assertDataFields,
  assertExactKeys,
  readOptionalDataField,
  readTimeoutField,
  requireRecord,
} from '../validation.js';

const PROVIDER_TRANSPORT_LIVENESS_KEYS = Object.freeze([
  'responseStartTimeoutMilliseconds',
  'streamEventIdleTimeoutMilliseconds',
]);

export function parseStandaloneProviderTransportLivenessPolicy(
  value: unknown
): ProviderTransportLivenessPolicy {
  if (value === undefined) return defineProviderTransportLivenessPolicy(undefined);
  const record = requireRecord(value, 'Standalone provider transportLivenessPolicy');
  assertDataFields(record, 'Standalone provider transportLivenessPolicy');
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

const PROVIDER_KEYS = Object.freeze(['config', 'transportLivenessPolicy', 'textTokenCounter']);

export function parseProvider(value: unknown): StandaloneProviderConfig {
  const record = requireRecord(value, 'Standalone provider');
  assertExactKeys(record, PROVIDER_KEYS, 'Standalone provider');
  const config = readOptionalDataField(record, 'config', 'Standalone provider config');
  if (config === undefined) {
    throw new AgentBaseStandaloneError('Standalone provider must define config.');
  }
  return Object.freeze({
    config: defineProviderConfig(config),
    ...(Object.hasOwn(record, 'textTokenCounter')
      ? {
          textTokenCounter: defineTextTokenCounterConfig(
            readOptionalDataField(record, 'textTokenCounter', 'Standalone text token counter')
          ),
        }
      : {}),
    transportLivenessPolicy: parseStandaloneProviderTransportLivenessPolicy(
      readOptionalDataField(
        record,
        'transportLivenessPolicy',
        'Standalone provider transportLivenessPolicy'
      )
    ),
  });
}
