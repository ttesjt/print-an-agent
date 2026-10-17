import type { ExecutionPolicy } from '../contracts/document.js';

export const DEFAULT_MEMORY_OPTIONS = Object.freeze({
  maxContextTokens: 4096,
  maxItems: null,
  maxItemTokens: null,
  render: Object.freeze({ format: 'text' as const, separator: '\n' }),
  compactionTarget: Object.freeze({ ratio: 0.8, reserveTokens: 0 }),
});
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = Object.freeze({
  maxConflictRetries: 2,
  maxCompactionPasses: 3,
  retrySafetyFactor: 0.9,
  minPlannerTargetTokens: 1,
  maxInputTokens: null,
  timeoutMs: null,
});
