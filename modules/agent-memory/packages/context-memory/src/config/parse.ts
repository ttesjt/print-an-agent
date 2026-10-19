import type {
  ExecutionPolicy,
  MemoryConfig,
  MemoryConfigInput,
  RenderOptions,
} from '../contracts/document.js';
import { ContextMemoryError } from '../errors.js';
import { identity, integer, jsonObject, keys, record } from '../validation/value.js';
import { DEFAULT_EXECUTION_POLICY, DEFAULT_MEMORY_OPTIONS } from './defaults.js';
import { parseTokenTarget } from './target.js';

export function parseRenderOptions(value: unknown): RenderOptions {
  const input = record(value, 'render', 'CONFIG_INVALID');
  if (input.format === 'text') {
    keys(input, ['format', 'separator'], 'CONFIG_INVALID');
    if ('separator' in input && typeof input.separator !== 'string')
      throw new ContextMemoryError('CONFIG_INVALID', 'separator must be a string.');
    return {
      format: 'text',
      separator:
        typeof input.separator === 'string'
          ? input.separator
          : DEFAULT_MEMORY_OPTIONS.render.separator,
    };
  }
  if (input.format === 'json') {
    keys(input, ['format'], 'CONFIG_INVALID');
    return { format: 'json' };
  }
  if (input.format === 'custom') {
    keys(input, ['format', 'rendererRef', 'options'], 'CONFIG_INVALID');
    return {
      format: 'custom',
      rendererRef: identity(input.rendererRef, 'rendererRef'),
      options: jsonObject('options' in input ? input.options : {}),
    };
  }
  throw new ContextMemoryError('CONFIG_INVALID', 'Unknown render format.');
}
function limit(value: unknown, name: string, minimum = 1): number | null {
  return value === null ? null : integer(value, name, minimum, 'CONFIG_INVALID');
}

export function resolveMemoryConfig(
  value: unknown = {},
  defaults: MemoryConfigInput = {}
): MemoryConfig {
  try {
    const input = record(value, 'config', 'CONFIG_INVALID');
    const inherited = record(defaults, 'default config', 'CONFIG_INVALID');
    const fields = [
      'measurementRef',
      'render',
      'maxContextTokens',
      'maxItems',
      'maxItemTokens',
      'compactionTarget',
    ];
    keys(input, fields, 'CONFIG_INVALID');
    keys(inherited, fields, 'CONFIG_INVALID');
    const merged: Record<string, unknown> = { ...DEFAULT_MEMORY_OPTIONS, ...inherited, ...input };
    return {
      measurementRef: identity(merged.measurementRef, 'measurementRef'),
      render: parseRenderOptions(merged.render),
      maxContextTokens: limit(merged.maxContextTokens, 'maxContextTokens'),
      maxItems: limit(merged.maxItems, 'maxItems'),
      maxItemTokens: limit(merged.maxItemTokens, 'maxItemTokens'),
      compactionTarget: parseTokenTarget(merged.compactionTarget),
    };
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.code === 'CONFIG_INVALID') throw cause;
    throw new ContextMemoryError('CONFIG_INVALID', 'Invalid memory configuration.', { cause });
  }
}

export function resolveExecutionPolicy(value: unknown = {}): ExecutionPolicy {
  const input = record(value, 'execution policy', 'CONFIG_INVALID');
  keys(input, Object.keys(DEFAULT_EXECUTION_POLICY), 'CONFIG_INVALID');
  const merged = { ...DEFAULT_EXECUTION_POLICY, ...input };
  const factor = merged.retrySafetyFactor;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor > 1)
    throw new ContextMemoryError('CONFIG_INVALID', 'retrySafetyFactor must be > 0 and <= 1.');
  return {
    maxConflictRetries: limit(merged.maxConflictRetries, 'maxConflictRetries', 0),
    maxCompactionPasses: limit(merged.maxCompactionPasses, 'maxCompactionPasses', 0),
    retrySafetyFactor: factor,
    minPlannerTargetTokens: integer(
      merged.minPlannerTargetTokens,
      'minPlannerTargetTokens',
      1,
      'CONFIG_INVALID'
    ),
    maxInputTokens: limit(merged.maxInputTokens, 'maxInputTokens'),
    timeoutMs: limit(merged.timeoutMs, 'timeoutMs'),
  };
}
