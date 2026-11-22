export type {
  CompactionTarget,
  MemoryBudgetTarget,
  MemoryBudgetViolation,
  MemoryCandidateAssessment,
} from './types.js';
export { DEFAULT_COMPACTION_TARGET } from './defaults.js';
export { assertExactMemoryMeasurement } from './exactness.js';
export { assertMemoryBudget } from './assertions.js';
export { assessMemoryCandidate } from './assessment.js';
export { parseTokenTarget, resolveCompactionTarget } from './targets.js';
export { resolveMemoryBudgetTarget } from './measurement-target.js';
