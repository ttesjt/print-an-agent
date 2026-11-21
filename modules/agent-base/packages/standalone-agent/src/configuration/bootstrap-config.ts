import { AgentBaseStandaloneError } from '../errors.js';
import { parseStandaloneConfigBindings, parseStandaloneExecutionFields } from './agent-config.js';
import { parseIdentity } from './fields/identity.js';
import { parsePersistence } from './fields/persistence.js';
import type { StandaloneAgentBootstrapConfig } from './types/bootstrap.js';
import { assertExactKeys, requireRecord } from './validation.js';

const BOOTSTRAP_CONFIG_KEYS = Object.freeze([
  'schemaVersion',
  'identity',
  'provider',
  'credential',
  'persistence',
  'mainActor',
  'request',
  'sessionCompaction',
]);

function parseStandaloneBootstrapConfig(input: unknown): StandaloneAgentBootstrapConfig {
  const record = requireRecord(input, 'Standalone Agent Base configuration');
  assertExactKeys(record, BOOTSTRAP_CONFIG_KEYS, 'Standalone Agent Base configuration');
  if (record.schemaVersion !== 1) {
    throw new AgentBaseStandaloneError('Standalone configuration schemaVersion must equal 1.');
  }
  const { provider, credential, mainActor } = parseStandaloneConfigBindings(
    record,
    'Standalone Agent Base'
  );
  return Object.freeze({
    schemaVersion: 1,
    identity: parseIdentity(record.identity),
    provider,
    ...(credential === undefined ? {} : { credential }),
    persistence: parsePersistence(record.persistence),
    mainActor,
    ...parseStandaloneExecutionFields(record, 'Standalone Agent Base'),
  });
}

export function defineStandaloneAgentBootstrapConfig(
  input: unknown
): StandaloneAgentBootstrapConfig {
  try {
    return parseStandaloneBootstrapConfig(input);
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone Agent Base configuration is invalid.', {
      cause,
    });
  }
}
