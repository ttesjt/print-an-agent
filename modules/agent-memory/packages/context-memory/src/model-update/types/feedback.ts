import type { ExecutionPolicy } from '../policy/index.js';
import type { MemoryCandidateAssessment } from '../../budget/index.js';

export interface MemoryCompactionFeedback {
  readonly currentTargetTokens: number;
  readonly assessment: MemoryCandidateAssessment;
  readonly policy: Pick<ExecutionPolicy, 'retrySafetyFactor' | 'minPlannerTargetTokens'>;
}
