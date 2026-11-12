import {
  AgentConfigError,
  normalizeConfigValue,
  type AgentConfigCodec,
  type ConfigValue,
} from '@print-an-agent/base-config';

function encodeConfig<TConfig>(codec: AgentConfigCodec<TConfig>, config: TConfig): ConfigValue {
  try {
    return normalizeConfigValue(codec.encode(config));
  } catch (cause: unknown) {
    throw new AgentConfigError('CONFIG_INVALID', 'Agent config could not be encoded.', { cause });
  }
}

export function decodeManagedAgentConfig<TConfig>(
  codec: AgentConfigCodec<TConfig>,
  input: unknown
): TConfig {
  try {
    return codec.decode(input);
  } catch (cause: unknown) {
    throw new AgentConfigError('CONFIG_INVALID', 'Agent config did not satisfy its codec.', {
      cause,
    });
  }
}

export function canonicalizeManagedAgentConfig<TConfig>(
  codec: AgentConfigCodec<TConfig>,
  config: TConfig
): TConfig {
  return decodeManagedAgentConfig(codec, encodeConfig(codec, config));
}

function configValuesEqual(left: ConfigValue, right: ConfigValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (isConfigArray(left) || isConfigArray(right)) {
    return (
      isConfigArray(left) &&
      isConfigArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => {
        const rightEntry = right[index];
        return rightEntry !== undefined && configValuesEqual(entry, rightEntry);
      })
    );
  }
  if (!isConfigRecord(left) || !isConfigRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => {
    if (key !== rightKeys[index] || !Object.hasOwn(right, key)) return false;
    const leftValue = left[key];
    const rightValue = right[key];
    return leftValue !== undefined && rightValue !== undefined
      ? configValuesEqual(leftValue, rightValue)
      : leftValue === rightValue;
  });
}

function isConfigArray(value: ConfigValue): value is readonly ConfigValue[] {
  return Array.isArray(value);
}

function isConfigRecord(value: ConfigValue): value is Readonly<Record<string, ConfigValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function managedAgentConfigsEqual<TConfig>(
  codec: AgentConfigCodec<TConfig>,
  left: TConfig,
  right: TConfig
): boolean {
  return configValuesEqual(encodeConfig(codec, left), encodeConfig(codec, right));
}
