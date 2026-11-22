import type { ExecutionPolicy } from './types.js';
import { ContextMemoryError } from '../../errors.js';
import { integer, keys, record, nullableInteger } from '../../values/index.js';
import { DEFAULT_EXECUTION_POLICY } from './defaults.js';

export function resolveExecutionPolicy(value: unknown = {}): ExecutionPolicy {
  const input = record(value, 'execution policy', 'CONFIG_INVALID');
  keys(input, Object.keys(DEFAULT_EXECUTION_POLICY), 'CONFIG_INVALID');
  const merged = { ...DEFAULT_EXECUTION_POLICY, ...input };
  const factor = merged.retrySafetyFactor;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor > 1)
    throw new ContextMemoryError('CONFIG_INVALID', 'retrySafetyFactor must be > 0 and <= 1.');
  return {
    maxConflictRetries: nullableInteger(merged.maxConflictRetries, 'maxConflictRetries', 0),
    maxCompactionPasses: nullableInteger(merged.maxCompactionPasses, 'maxCompactionPasses', 0),
    retrySafetyFactor: factor,
    minPlannerTargetTokens: integer(
      merged.minPlannerTargetTokens,
      'minPlannerTargetTokens',
      1,
      'CONFIG_INVALID'
    ),
    maxInputTokens: nullableInteger(merged.maxInputTokens, 'maxInputTokens'),
    timeoutMs: nullableInteger(merged.timeoutMs, 'timeoutMs'),
  };
}
