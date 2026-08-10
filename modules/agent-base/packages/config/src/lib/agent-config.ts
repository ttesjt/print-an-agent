import type {
  AgentConfigCodec,
  AgentConfigSnapshot,
  ConfigValue,
  ResolveAgentConfigOptions,
  ResolvedAgentConfig,
  WriteAgentConfigOptions,
} from '../types/config.js';
import { AgentConfigError } from '../types/errors.js';
import { normalizeConfigValue } from './config-value.js';

function validateSchemaVersion(schemaVersion: number): void {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new AgentConfigError(
      'CONFIG_SCHEMA_VERSION_INVALID',
      'Config codec schemaVersion must be a positive safe integer.'
    );
  }
}

function decodeConfig<TConfig>(codec: AgentConfigCodec<TConfig>, value: unknown): TConfig {
  try {
    return codec.decode(value);
  } catch (cause: unknown) {
    throw new AgentConfigError('CONFIG_INVALID', 'Agent config did not satisfy its codec.', {
      cause,
    });
  }
}

function encodeAndValidate<TConfig>(
  codec: AgentConfigCodec<TConfig>,
  config: TConfig
): Readonly<{ config: TConfig; value: ConfigValue }> {
  let value: ConfigValue;
  try {
    value = normalizeConfigValue(codec.encode(config));
  } catch (cause: unknown) {
    throw new AgentConfigError('CONFIG_INVALID', 'Agent config could not be encoded.', { cause });
  }

  return Object.freeze({ config: decodeConfig(codec, value), value });
}

function validateSnapshot<TConfig>(
  options: Pick<ResolveAgentConfigOptions<TConfig>, 'identity' | 'codec'>,
  snapshot: AgentConfigSnapshot
): TConfig {
  if (snapshot.agentId !== options.identity.id) {
    throw new AgentConfigError(
      'CONFIG_SNAPSHOT_IDENTITY_MISMATCH',
      `Config adapter returned data for "${snapshot.agentId}" while resolving "${options.identity.id}".`
    );
  }
  if (snapshot.schemaVersion !== options.codec.schemaVersion) {
    throw new AgentConfigError(
      'CONFIG_SCHEMA_VERSION_UNSUPPORTED',
      `Config schema version ${snapshot.schemaVersion} is not supported by codec version ${options.codec.schemaVersion}.`
    );
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      'Config adapter returned an invalid revision.'
    );
  }

  return decodeConfig(options.codec, normalizeConfigValue(snapshot.value));
}

export async function resolveAgentConfig<TConfig>(
  options: ResolveAgentConfigOptions<TConfig>
): Promise<ResolvedAgentConfig<TConfig>> {
  validateSchemaVersion(options.codec.schemaVersion);
  const snapshot = await options.adapter.read(options.identity.id);
  if (snapshot !== undefined) {
    return Object.freeze({
      identity: options.identity,
      config: validateSnapshot(options, snapshot),
      source: 'stored',
      revision: snapshot.revision,
    });
  }

  if (options.createDefault === undefined) {
    throw new AgentConfigError(
      'CONFIG_NOT_FOUND',
      `No stored or default config exists for agent "${options.identity.id}".`
    );
  }

  const validated = encodeAndValidate(options.codec, options.createDefault());
  return Object.freeze({
    identity: options.identity,
    config: validated.config,
    source: 'default',
    revision: null,
  });
}

export async function writeAgentConfig<TConfig>(
  options: WriteAgentConfigOptions<TConfig>
): Promise<ResolvedAgentConfig<TConfig>> {
  validateSchemaVersion(options.codec.schemaVersion);
  const validated = encodeAndValidate(options.codec, options.config);
  const snapshot = await options.adapter.write({
    agentId: options.identity.id,
    schemaVersion: options.codec.schemaVersion,
    value: validated.value,
    expectedRevision: options.expectedRevision,
  });

  return Object.freeze({
    identity: options.identity,
    config: validateSnapshot(options, snapshot),
    source: 'stored',
    revision: snapshot.revision,
  });
}
