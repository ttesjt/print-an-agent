export type { CompactionTarget } from './types.js';

export { DEFAULT_COMPACTION_TARGET } from './defaults.js';

export type { MemoryBudgetTarget } from './types.js';

export type { MemoryBudgetViolation } from './types.js';

export type { MemoryCandidateAssessment } from './types.js';

export { assertExactMemoryMeasurement } from './exactness.js';

export { assertMemoryBudget } from './assertions.js';

export { assessMemoryCandidate } from './assessment.js';

export { memoryBudgetViolations } from './evaluation.js';

export { parseTokenTarget } from './targets.js';

export { resolveCompactionTarget } from './targets.js';

export { resolveMemoryBudgetTarget } from './measurement-target.js';
