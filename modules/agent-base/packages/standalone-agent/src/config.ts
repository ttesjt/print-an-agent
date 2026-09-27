import { isAbsolute } from 'node:path';
import { defineActor, type ActorInvocationConfig } from '@ta-agent/base-actor';
import { defineProviderConfig } from '@ta-agent/base-composition';
import type { AgentConfigCodec, ConfigValue } from '@ta-agent/base-config';
import { defineAgentIdentity, type AgentIdentity } from '@ta-agent/base-identity';
import { AgentBaseStandaloneError } from './errors.js';
import {
  parseStandaloneActorInvocationPolicy,
  parseStandaloneProviderTransportLivenessPolicy,
  parseStandaloneRequestExecution,
  parseStandaloneSessionCompactionExecution,
} from './timeout-config.js';
import type {
  StandaloneCredentialBindingInput,
  StandaloneMainActorConfig,
  StandaloneProviderConfig,
  StandalonePersistenceConfig,
  StandaloneAgentConfig,
  StandaloneAgentDefinition,
  StandaloneAgentDefinitionInput,
  StandaloneAgentManifest,
} from './types.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

const CONFIG_KEYS = Object.freeze([
  'schemaVersion',
  'identity',
  'provider',
  'credential',
  'persistence',
  'mainActor',
  'request',
  'sessionCompaction',
]);
const DEFINITION_KEYS = Object.freeze([
  'provider',
  'credential',
  'mainActor',
  'request',
  'sessionCompaction',
]);
const MANIFEST_KEYS = Object.freeze(['schemaVersion', 'identity', 'config']);
const IDENTITY_KEYS = Object.freeze(['id', 'displayName']);
const CREDENTIAL_KEYS = Object.freeze(['reference', 'environmentVariable']);
const PROVIDER_KEYS = Object.freeze(['config', 'transportLivenessPolicy']);
const MAIN_ACTOR_KEYS = Object.freeze(['instructions', 'invocationConfig', 'invocationPolicy']);
const INVOCATION_CONFIG_KEYS = Object.freeze(['temperature', 'maxOutputTokens']);
const MEMORY_PERSISTENCE_KEYS = Object.freeze(['kind']);
const SQLITE_PERSISTENCE_KEYS = Object.freeze(['kind', 'databasePath']);
const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const MAX_ENVIRONMENT_VARIABLE_LENGTH = 128;
const MAX_DATABASE_PATH_LENGTH = 4_096;

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
  const unexpected = Reflect.ownKeys(value).find(
    (key) => typeof key !== 'string' || !allowed.includes(key)
  );
  if (unexpected !== undefined) {
    throw new AgentBaseStandaloneError(
      `${label} contains unsupported field "${String(unexpected)}".`
    );
  }
}

function readOptionalDataField(record: UnknownRecord, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor)) {
    throw new AgentBaseStandaloneError(`${label} must be an enumerable data field.`);
  }
  return descriptor.value;
}

function parseIdentity(value: unknown): AgentIdentity {
  const record = requireRecord(value, 'Standalone identity');
  assertExactKeys(record, IDENTITY_KEYS, 'Standalone identity');
  if (typeof record.id !== 'string') {
    throw new AgentBaseStandaloneError('Standalone identity ID must be a string.');
  }
  if (record.displayName !== undefined && typeof record.displayName !== 'string') {
    throw new AgentBaseStandaloneError('Standalone identity display name must be a string.');
  }
  return defineAgentIdentity({
    id: record.id,
    ...(record.displayName === undefined ? {} : { displayName: record.displayName }),
  });
}

function parseInvocationConfig(value: unknown): ActorInvocationConfig {
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
  const definition = defineActor({
    id: 'main',
    engineId: 'standalone-config-validation',
    invocationConfig: {
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    },
  });
  return definition.invocationConfig;
}

function parseMainActor(value: unknown): StandaloneMainActorConfig {
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
  const definition = defineActor({
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

function parseProvider(value: unknown): StandaloneProviderConfig {
  const record = requireRecord(value, 'Standalone provider');
  assertExactKeys(record, PROVIDER_KEYS, 'Standalone provider');
  const config = readOptionalDataField(record, 'config', 'Standalone provider config');
  if (config === undefined) {
    throw new AgentBaseStandaloneError('Standalone provider must define config.');
  }
  return Object.freeze({
    config: defineProviderConfig(config),
    transportLivenessPolicy: parseStandaloneProviderTransportLivenessPolicy(
      readOptionalDataField(
        record,
        'transportLivenessPolicy',
        'Standalone provider transportLivenessPolicy'
      )
    ),
  });
}

function parsePersistence(value: unknown): StandalonePersistenceConfig {
  const record = requireRecord(value, 'Standalone persistence');
  if (record.kind === 'memory') {
    assertExactKeys(record, MEMORY_PERSISTENCE_KEYS, 'Memory persistence');
    return Object.freeze({ kind: 'memory' });
  }
  if (record.kind === 'sqlite') {
    assertExactKeys(record, SQLITE_PERSISTENCE_KEYS, 'SQLite persistence');
    if (
      typeof record.databasePath !== 'string' ||
      record.databasePath.length === 0 ||
      record.databasePath.length > MAX_DATABASE_PATH_LENGTH ||
      record.databasePath.includes('\0') ||
      !isAbsolute(record.databasePath)
    ) {
      throw new AgentBaseStandaloneError(
        'SQLite databasePath must be a non-empty bounded absolute path.'
      );
    }
    return Object.freeze({ kind: 'sqlite', databasePath: record.databasePath });
  }
  throw new AgentBaseStandaloneError('Standalone persistence kind is invalid.');
}

function parseCredential(
  value: unknown,
  expectedReference: string | undefined
): Readonly<StandaloneCredentialBindingInput> | undefined {
  if (expectedReference === undefined) {
    if (value !== undefined) {
      throw new AgentBaseStandaloneError(
        'Keyless provider configuration cannot include a credential binding.'
      );
    }
    return undefined;
  }
  const record = requireRecord(value, 'Standalone credential binding');
  assertExactKeys(record, CREDENTIAL_KEYS, 'Standalone credential binding');
  if (record.reference !== expectedReference) {
    throw new AgentBaseStandaloneError(
      'Standalone credential binding must match the provider credential reference.'
    );
  }
  if (
    typeof record.environmentVariable !== 'string' ||
    record.environmentVariable.length > MAX_ENVIRONMENT_VARIABLE_LENGTH ||
    !ENVIRONMENT_VARIABLE_PATTERN.test(record.environmentVariable)
  ) {
    throw new AgentBaseStandaloneError(
      'Credential environmentVariable must be a bounded portable environment name.'
    );
  }
  return Object.freeze({
    reference: expectedReference,
    environmentVariable: record.environmentVariable,
  });
}

function parseStandaloneConfig(input: unknown): StandaloneAgentConfig {
  const record = requireRecord(input, 'Standalone Agent Base configuration');
  assertExactKeys(record, CONFIG_KEYS, 'Standalone Agent Base configuration');
  if (record.schemaVersion !== 1) {
    throw new AgentBaseStandaloneError('Standalone configuration schemaVersion must equal 1.');
  }
  const provider = parseProvider(
    readOptionalDataField(record, 'provider', 'Standalone Agent Base provider')
  );
  const credential = parseCredential(record.credential, provider.config.reference.credentialRef);
  const mainActor = parseMainActor(
    readOptionalDataField(record, 'mainActor', 'Standalone Agent Base mainActor')
  );
  return Object.freeze({
    schemaVersion: 1,
    identity: parseIdentity(record.identity),
    provider,
    ...(credential === undefined ? {} : { credential }),
    persistence: parsePersistence(record.persistence),
    mainActor,
    request: parseStandaloneRequestExecution(
      readOptionalDataField(record, 'request', 'Standalone Agent Base request')
    ),
    sessionCompaction: parseStandaloneSessionCompactionExecution(
      readOptionalDataField(record, 'sessionCompaction', 'Standalone Agent Base sessionCompaction')
    ),
  });
}

function parseStandaloneAgentDefinition(input: unknown): StandaloneAgentDefinition {
  const record = requireRecord(input, 'Standalone Agent definition');
  assertExactKeys(record, DEFINITION_KEYS, 'Standalone Agent definition');
  const provider = parseProvider(
    readOptionalDataField(record, 'provider', 'Standalone Agent definition provider')
  );
  const credential = parseCredential(record.credential, provider.config.reference.credentialRef);
  const mainActor = parseMainActor(
    readOptionalDataField(record, 'mainActor', 'Standalone Agent definition mainActor')
  );
  return Object.freeze({
    provider,
    ...(credential === undefined ? {} : { credential }),
    mainActor,
    request: parseStandaloneRequestExecution(
      readOptionalDataField(record, 'request', 'Standalone Agent definition request')
    ),
    sessionCompaction: parseStandaloneSessionCompactionExecution(
      readOptionalDataField(
        record,
        'sessionCompaction',
        'Standalone Agent definition sessionCompaction'
      )
    ),
  });
}

function encodeProviderReference(
  reference: StandaloneAgentDefinition['provider']['config']['reference']
): ConfigValue {
  return {
    provider: reference.provider,
    model: reference.model,
    ...(reference.baseUrl === undefined ? {} : { baseUrl: reference.baseUrl }),
    ...(reference.credentialRef === undefined ? {} : { credentialRef: reference.credentialRef }),
  };
}

function encodeProviderConfig(
  config: StandaloneAgentDefinition['provider']['config']
): ConfigValue {
  const provider: ConfigValue =
    config.kind === 'builtin'
      ? {
          kind: config.kind,
          reference: encodeProviderReference(config.reference),
        }
      : {
          kind: config.kind,
          reference: encodeProviderReference(config.reference),
          contextWindowTokens: config.contextWindowTokens,
          maxOutputTokens: config.maxOutputTokens,
          supportsReasoning: config.supportsReasoning,
          compatibility: {
            supportsDeveloperRole: config.compatibility.supportsDeveloperRole,
          },
        };
  return provider;
}

function encodeStandaloneAgentDefinition(config: StandaloneAgentDefinition): ConfigValue {
  const credential: ConfigValue | undefined =
    config.credential === undefined
      ? undefined
      : {
          reference: config.credential.reference,
          environmentVariable: config.credential.environmentVariable,
        };
  const mainActor: ConfigValue = {
    ...(config.mainActor.instructions === undefined
      ? {}
      : { instructions: config.mainActor.instructions }),
    invocationConfig: {
      ...(config.mainActor.invocationConfig.temperature === undefined
        ? {}
        : { temperature: config.mainActor.invocationConfig.temperature }),
      ...(config.mainActor.invocationConfig.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: config.mainActor.invocationConfig.maxOutputTokens }),
    },
    invocationPolicy: {
      timeoutMilliseconds: config.mainActor.invocationPolicy.timeoutMilliseconds,
    },
  };
  return {
    provider: {
      config: encodeProviderConfig(config.provider.config),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds:
          config.provider.transportLivenessPolicy.responseStartTimeoutMilliseconds,
        streamEventIdleTimeoutMilliseconds:
          config.provider.transportLivenessPolicy.streamEventIdleTimeoutMilliseconds,
      },
    },
    ...(credential === undefined ? {} : { credential }),
    mainActor,
    request: { timeoutMilliseconds: config.request.timeoutMilliseconds },
    sessionCompaction: {
      timeoutMilliseconds: config.sessionCompaction.timeoutMilliseconds,
    },
  };
}

export function defineStandaloneAgentConfig(input: unknown): StandaloneAgentConfig {
  try {
    return parseStandaloneConfig(input);
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone Agent Base configuration is invalid.', {
      cause,
    });
  }
}

export function defineStandaloneAgentDefinition(input: unknown): StandaloneAgentDefinition {
  try {
    return parseStandaloneAgentDefinition(input);
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone Agent definition is invalid.', { cause });
  }
}

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
      config: parseStandaloneAgentDefinition(
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
    config: encodeStandaloneAgentDefinition(manifest.config),
  };
}

export const STANDALONE_AGENT_DEFINITION_CODEC: AgentConfigCodec<StandaloneAgentDefinition> =
  Object.freeze({
    schemaVersion: 1,
    decode: (value: unknown) => defineStandaloneAgentDefinition(value),
    encode: (config: StandaloneAgentDefinitionInput) =>
      encodeStandaloneAgentDefinition(defineStandaloneAgentDefinition(config)),
  });
