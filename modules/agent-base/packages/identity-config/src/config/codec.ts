import type { AgentConfigCodec, ConfigValue } from './types/codec.js';
import { AgentConfigError } from './errors.js';
import { normalizeConfigValue } from './value.js';

export function validateSchemaVersion(schemaVersion: number): void {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new AgentConfigError(
      'CONFIG_SCHEMA_VERSION_INVALID',
      'Config codec schemaVersion must be a positive safe integer.'
    );
  }
}

export function decodeConfig<TConfig>(codec: AgentConfigCodec<TConfig>, value: unknown): TConfig {
  try {
    return codec.decode(value);
  } catch (cause: unknown) {
    throw new AgentConfigError('CONFIG_INVALID', 'Agent config did not satisfy its codec.', {
      cause,
    });
  }
}

export function encodeAndValidate<TConfig>(
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
