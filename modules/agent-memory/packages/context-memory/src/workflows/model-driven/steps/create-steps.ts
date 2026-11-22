import type { ModelMemoryOperation } from '../../../model-update/index.js';
import type { ModelMemorySteps } from '../types/steps.js';
import { memoryPreparationSteps } from './preparation.js';
import { memoryCandidateSteps } from './candidate.js';
import { memoryPlanningSteps } from './planning.js';

export function modelMemorySteps(operation: ModelMemoryOperation): ModelMemorySteps {
  return {
    ...memoryPreparationSteps(operation),
    ...memoryCandidateSteps(),
    ...memoryPlanningSteps(operation),
  };
}
