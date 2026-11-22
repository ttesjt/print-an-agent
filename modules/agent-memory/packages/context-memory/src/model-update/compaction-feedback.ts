import { ContextMemoryError } from '../errors.js';
import { resolveExecutionPolicy } from './policy/index.js';
import { integer } from '../values/index.js';
import type { MemoryCompactionFeedback } from './types/feedback.js';

/** Tighten a soft body goal without subtracting fictitious additive renderer overhead. */
export function refineMemoryCompactionTarget(input: MemoryCompactionFeedback): number {
  const { assessment, currentTargetTokens } = input;
  const policy = resolveExecutionPolicy(input.policy);
  integer(assessment.contentTokens, 'candidate content tokens');
  for (const issue of assessment.violations) {
    integer(issue.limit, 'feedback limit', 1);
    integer(issue.actual, 'feedback actual', 1);
    if (issue.actual <= issue.limit)
      throw new ContextMemoryError('CONFIG_INVALID', 'Feedback requires actual violations.');
  }
  if (
    assessment.accepted ||
    assessment.violations.length === 0 ||
    !Number.isSafeInteger(currentTargetTokens) ||
    currentTargetTokens < policy.minPlannerTargetTokens
  )
    throw new ContextMemoryError(
      'CONFIG_INVALID',
      'Feedback requires a rejected measured candidate and a valid soft target.'
    );
  const ratio = Math.min(...assessment.violations.map((issue) => issue.limit / issue.actual));
  return Math.max(
    policy.minPlannerTargetTokens,
    Math.floor(
      Math.min(currentTargetTokens, assessment.contentTokens) * ratio * policy.retrySafetyFactor
    )
  );
}
