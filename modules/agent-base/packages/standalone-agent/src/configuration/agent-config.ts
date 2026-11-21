import { AgentBaseStandaloneError } from '../errors.js';
import { parseCredential } from './fields/credential.js';
import { parseMainActor } from './fields/main-actor.js';
import { parseProvider } from './fields/provider.js';
import { parseStandaloneRequestExecution } from './fields/request.js';
import { parseStandaloneSessionCompactionExecution } from './fields/session-compaction.js';
import type { StandaloneAgentConfig } from './types/agent.js';
import {
  assertExactKeys,
  readOptionalDataField,
  requireRecord,
  type UnknownRecord,
} from './validation.js';

const AGENT_CONFIG_KEYS = Object.freeze([
  'provider',
  'credential',
  'mainActor',
  'request',
  'sessionCompaction',
]);

export function parseStandaloneConfigBindings(
  record: UnknownRecord,
  label: string
): Pick<StandaloneAgentConfig, 'provider' | 'credential' | 'mainActor'> {
  const provider = parseProvider(readOptionalDataField(record, 'provider', `${label} provider`));
  const credential = parseCredential(record.credential, provider.config.reference.credentialRef);
  const mainActor = parseMainActor(
    readOptionalDataField(record, 'mainActor', `${label} mainActor`)
  );
  return { provider, ...(credential === undefined ? {} : { credential }), mainActor };
}

export function parseStandaloneExecutionFields(
  record: UnknownRecord,
  label: string
): Pick<StandaloneAgentConfig, 'request' | 'sessionCompaction'> {
  return {
    request: parseStandaloneRequestExecution(
      readOptionalDataField(record, 'request', `${label} request`)
    ),
    sessionCompaction: parseStandaloneSessionCompactionExecution(
      readOptionalDataField(record, 'sessionCompaction', `${label} sessionCompaction`)
    ),
  };
}

export function parseStandaloneAgentConfig(input: unknown): StandaloneAgentConfig {
  const record = requireRecord(input, 'Standalone Agent Config');
  assertExactKeys(record, AGENT_CONFIG_KEYS, 'Standalone Agent Config');
  const bindings = parseStandaloneConfigBindings(record, 'Standalone Agent Config');
  return Object.freeze({
    ...bindings,
    ...parseStandaloneExecutionFields(record, 'Standalone Agent Config'),
  });
}

export function defineStandaloneAgentConfig(input: unknown): StandaloneAgentConfig {
  try {
    return parseStandaloneAgentConfig(input);
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone Agent Config is invalid.', { cause });
  }
}
