import type { MemoryCandidateAssessment } from '../../../budget/index.js';
import { ContextMemoryError } from '../../../errors.js';
import type { ModelMemoryContext } from '../types/workflow.js';

export function requireCandidateAssessment(context: ModelMemoryContext): MemoryCandidateAssessment {
  if (context.state.assessment === undefined)
    throw new ContextMemoryError('INPUT_INVALID', 'Candidate assessment is missing.');
  return context.state.assessment;
}

export async function measureCandidate(context: ModelMemoryContext): Promise<void> {
  await context.runStep('measureCandidate');
  await context.runStep('assessCandidate');
}
