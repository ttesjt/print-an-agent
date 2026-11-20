import type { ConfigValue } from './types/codec.js';
import { AgentConfigError } from './errors.js';

const MAX_CONFIG_VALUE_DEPTH = 64;
const MAX_CONFIG_VALUE_NODES = 100_000;

interface TraversalState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

function invalid(message: string): never {
  throw new AgentConfigError('CONFIG_INVALID', message);
}

function normalizeValue(value: unknown, depth: number, state: TraversalState): ConfigValue {
  state.nodes += 1;
  if (state.nodes > MAX_CONFIG_VALUE_NODES) {
    invalid(`Agent config cannot contain more than ${MAX_CONFIG_VALUE_NODES} values.`);
  }
  if (depth > MAX_CONFIG_VALUE_DEPTH) {
    invalid(`Agent config cannot exceed ${MAX_CONFIG_VALUE_DEPTH} levels of nesting.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Agent config numbers must be finite.');
    return value;
  }
  if (typeof value !== 'object') {
    invalid('Agent config contains a value that cannot be represented as JSON.');
  }
  if (state.ancestors.has(value)) invalid('Agent config cannot contain cyclic values.');
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry) => normalizeValue(entry, depth + 1, state)));
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      invalid('Agent config objects must be plain JSON objects.');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      invalid('Agent config objects cannot contain symbol properties.');
    }
    const output: { [key: string]: ConfigValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(output, key, {
        value: normalizeValue(entry, depth + 1, state),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    state.ancestors.delete(value);
  }
}

export function normalizeConfigValue(value: unknown): ConfigValue {
  return normalizeValue(value, 0, { nodes: 0, ancestors: new WeakSet() });
}
