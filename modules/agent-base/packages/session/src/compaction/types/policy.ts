import type { ExecutionTimeoutMilliseconds } from '@print-an-agent/workflow-core';
import type { SessionCompactionTarget } from '../planning/types.js';

export interface SessionCompactionPolicy {
  readonly minimumCompletedTurns: number;
  readonly retainRecentTurns: number;
  readonly maxSourceTurns: number;
  readonly maxSourceCharacters: number;
  readonly maxContextTokens: number;
  readonly target: SessionCompactionTarget;
  readonly maxGenerationAttempts: number;
  readonly maxGenerationCharacters: number;
  readonly retrySafetyFactor: number;
  readonly minimumTargetTokens: number;
  readonly timeoutMilliseconds: ExecutionTimeoutMilliseconds;
}
