import type { MemoryConfig, TokenTarget } from '../types/document.js';
import { ContextMemoryError } from '../errors.js';
import { integer, keys, record } from '../values/index.js';
import { DEFAULT_COMPACTION_TARGET } from './defaults.js';

export function parseTokenTarget(value: unknown): TokenTarget {
  const input = record(value, 'token target', 'CONFIG_INVALID');
  keys(input, ['maxTokens', 'limitTokens', 'ratio', 'reserveTokens'], 'CONFIG_INVALID');
  if ('maxTokens' in input) {
    if (Object.keys(input).length !== 1)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Direct and calculated token targets cannot be mixed.'
      );
    return { maxTokens: integer(input.maxTokens, 'maxTokens', 1, 'CONFIG_INVALID') };
  }
  const ratio = input.ratio;
  if (
    'ratio' in input &&
    (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1)
  ) {
    throw new ContextMemoryError('CONFIG_INVALID', 'Target ratio must be > 0 and <= 1.');
  }
  return {
    ...('limitTokens' in input
      ? { limitTokens: integer(input.limitTokens, 'limitTokens', 1, 'CONFIG_INVALID') }
      : {}),
    ...(typeof ratio === 'number' ? { ratio } : {}),
    ...('reserveTokens' in input
      ? { reserveTokens: integer(input.reserveTokens, 'reserveTokens', 0, 'CONFIG_INVALID') }
      : {}),
  };
}

/** Resolves an operational target without changing the document's authority. */
export function resolveCompactionTarget(config: MemoryConfig, override?: TokenTarget): number {
  const spec = parseTokenTarget(override ?? config.compactionTarget);
  let result: number;
  if ('maxTokens' in spec && spec.maxTokens !== undefined) result = spec.maxTokens;
  else {
    const base = spec.limitTokens ?? config.maxContextTokens;
    if (base === null)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Compaction needs an explicit target when the document budget is disabled.'
      );
    const inheritedRatio = config.compactionTarget.ratio;
    result =
      Math.floor(base * (spec.ratio ?? inheritedRatio ?? DEFAULT_COMPACTION_TARGET.ratio)) -
      (spec.reserveTokens ?? DEFAULT_COMPACTION_TARGET.reserveTokens);
  }
  integer(result, 'resolved target', 1, 'CONFIG_INVALID');
  if (config.maxContextTokens !== null && result > config.maxContextTokens) {
    throw new ContextMemoryError(
      'CONFIG_INVALID',
      'Compaction target cannot exceed the document hard limit.'
    );
  }
  return result;
}
