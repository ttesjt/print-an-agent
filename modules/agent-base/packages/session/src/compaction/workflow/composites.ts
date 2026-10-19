import { AgentSessionError } from '../../errors.js';
import { SessionCompactionAttemptsExhaustedError } from '../errors.js';
import { requireCompactionState, compactionTimestamp } from './guards.js';
import type { SessionCompactionWorkflowContext } from './types.js';

export async function buildCompactedContext(
  context: SessionCompactionWorkflowContext
): Promise<void> {
  const source = requireCompactionState(context, 'source');
  const target = requireCompactionState(context, 'targetTokens');
  const tokenCounter = requireCompactionState(context, 'tokenCounter');
  const limit = context.resources.policy.maxGenerationAttempts;
  for (let attempt = 1; attempt <= limit; attempt++) {
    context.signal.throwIfAborted();
    context.state.attemptIndex = attempt;
    await context.runStep('prepareCompactionAttempt');
    await context.runStep('generateCompactionCandidate');
    await context.runStep('measureCompactionCandidate');
    await context.runStep('validateCompactionCandidate');
    if (
      context.state.source !== source ||
      context.state.targetTokens !== target ||
      context.state.tokenCounter !== tokenCounter
    ) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_INVALID',
        'Candidate Steps cannot replace frozen source, target or tokenizer bindings.'
      );
    }
    const assessment = requireCompactionState(context, 'assessment');
    if (assessment.status === 'accepted') {
      if (requireCompactionState(context, 'candidate').stopReason !== 'stop') {
        throw new AgentSessionError(
          'SESSION_COMPACTION_OUTPUT_INVALID',
          'Only a completed successful generation can be published.'
        );
      }
      context.state.compactedContext = Object.freeze({
        role: 'context',
        text: requireCompactionState(context, 'candidate').text,
        timestamp: compactionTimestamp(context),
      });
      return;
    }
    if (attempt < limit) {
      await context.runStep('refineCompactionPlan');
      const next = requireCompactionState(context, 'plannerTargetTokens');
      if (
        !Number.isSafeInteger(next) ||
        next < context.resources.policy.minimumTargetTokens ||
        next > target
      ) {
        throw new AgentSessionError(
          'SESSION_COMPACTION_INVALID',
          'Planner targets must remain within the fixed acceptance target and configured minimum.'
        );
      }
    }
  }
  const rejected = requireCompactionState(context, 'assessment');
  if (rejected.status !== 'rejected')
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Exhaustion requires a rejected candidate.'
    );
  throw new SessionCompactionAttemptsExhaustedError(
    {
      generationAttempts: requireCompactionState(context, 'attemptIndex'),
      reason: rejected.reason,
      ...(rejected.actualTokens === undefined ? {} : { actualTokens: rejected.actualTokens }),
      targetTokens: target,
    },
    { cause: rejected.cause }
  );
}
