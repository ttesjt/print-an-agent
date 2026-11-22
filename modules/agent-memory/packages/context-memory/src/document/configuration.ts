import type { MemoryConfig, RenderOptions } from '../types/document.js';
import type { MemoryConfigInput } from './types/configuration.js';
import { ContextMemoryError } from '../errors.js';
import { identity, jsonObject, keys, record, nullableInteger } from '../values/index.js';
import { DEFAULT_MEMORY_OPTIONS } from './defaults.js';
import { parseTokenTarget } from '../budget/index.js';

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
      maxContextTokens: nullableInteger(merged.maxContextTokens, 'maxContextTokens'),
      maxItems: nullableInteger(merged.maxItems, 'maxItems'),
      maxItemTokens: nullableInteger(merged.maxItemTokens, 'maxItemTokens'),
      compactionTarget: parseTokenTarget(merged.compactionTarget),
    };
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.code === 'CONFIG_INVALID') throw cause;
    throw new ContextMemoryError('CONFIG_INVALID', 'Invalid memory configuration.', { cause });
  }
}
