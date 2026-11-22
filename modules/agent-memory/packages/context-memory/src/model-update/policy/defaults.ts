import type { ExecutionPolicy } from './types.js';

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = Object.freeze({
  maxConflictRetries: 2,
  maxCompactionPasses: 3,
  retrySafetyFactor: 0.9,
  minPlannerTargetTokens: 1,
  maxInputTokens: null,
  timeoutMs: null,
});
