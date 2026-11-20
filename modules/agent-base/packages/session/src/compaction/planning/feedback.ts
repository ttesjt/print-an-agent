import { AgentSessionError } from '../../errors.js';
import { compactionInteger, compactionRatio } from '../input-validation.js';

export interface SessionCompactionFeedback {
  readonly currentTargetTokens: number;
  readonly actualTokens: number;
  readonly targetTokens: number;
  readonly retrySafetyFactor: number;
  readonly minimumTargetTokens: number;
}

/** Soft-target feedback only; it never changes the authoritative acceptance target. */
export function refineSessionCompactionPromptTarget(input: SessionCompactionFeedback): number {
  const current = compactionInteger(input.currentTargetTokens, 'Current planner target');
  const actual = compactionInteger(input.actualTokens, 'Actual candidate tokens');
  const target = compactionInteger(input.targetTokens, 'Acceptance target');
  const minimum = compactionInteger(input.minimumTargetTokens, 'Minimum planner target');
  const factor = compactionRatio(input.retrySafetyFactor, 'Retry safety factor');
  if (minimum > current || current > target || actual <= target) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Feedback requires an oversized candidate and a planner target within configured bounds.'
    );
  }
  return Math.max(minimum, Math.floor(Math.min(current, actual) * (target / actual) * factor));
}
