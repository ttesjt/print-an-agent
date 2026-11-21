import type { ConfigValue } from '@print-an-agent/base-identity-config/config';
import { AgentBaseStandaloneError } from '../errors.js';
import { parseStandaloneAgentConfig } from './agent-config.js';
import { encodeStandaloneAgentConfig } from './codec.js';
import { parseIdentity } from './fields/identity.js';
import type { StandaloneAgentManifest } from './types/manifest.js';
import { assertExactKeys, readOptionalDataField, requireRecord } from './validation.js';

const MANIFEST_KEYS = Object.freeze(['schemaVersion', 'identity', 'config']);

export function defineStandaloneAgentManifest(input: unknown): StandaloneAgentManifest {
  try {
    const record = requireRecord(input, 'Standalone Agent manifest');
    assertExactKeys(record, MANIFEST_KEYS, 'Standalone Agent manifest');
    if (record.schemaVersion !== 1) {
      throw new AgentBaseStandaloneError('Standalone Agent manifest schemaVersion must equal 1.');
    }
    return Object.freeze({
      schemaVersion: 1,
      identity: parseIdentity(record.identity),
      config: parseStandaloneAgentConfig(
        readOptionalDataField(record, 'config', 'Standalone Agent manifest config')
      ),
    });
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone Agent manifest is invalid.', { cause });
  }
}

export function encodeStandaloneAgentManifest(manifest: StandaloneAgentManifest): ConfigValue {
  return {
    schemaVersion: 1,
    identity: {
      id: manifest.identity.id,
      displayName: manifest.identity.displayName,
    },
    config: encodeStandaloneAgentConfig(manifest.config),
  };
}
