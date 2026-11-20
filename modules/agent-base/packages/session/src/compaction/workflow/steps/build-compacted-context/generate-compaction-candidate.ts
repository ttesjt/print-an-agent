import { AgentActorError } from '@print-an-agent/base-actor';
import { ActorError, ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { AgentSessionError } from '../../../../errors.js';
import { SESSION_COMPACTION_REJECTION_REASON } from '../../../rejection-reasons.js';
import { requireCompactionState } from '../../state-access.js';
import type { SessionCompactionWorkflowContext } from '../../types.js';

export async function generateCompactionCandidate(
  context: SessionCompactionWorkflowContext
): Promise<void> {
  const responsibility = requireCompactionState(context, 'responsibility');
  const messages = requireCompactionState(context, 'attemptMessages');
  try {
    const result = await responsibility.complete({
      instructions: context.resources.instructions,
      messages,
      maxOutputCharacters: context.resources.policy.maxGenerationCharacters,
      signal: context.signal,
    });
    context.state.candidate = result.message;
  } catch (cause: unknown) {
    // Actor owns its deadline even if the parent cancels while Engine cleanup is draining.
    if (cause instanceof ActorError && cause.code === 'ACTOR_INVOCATION_TIMEOUT') throw cause;
    context.signal.throwIfAborted();
    if (cause instanceof ModelInvocationError && cause.code === 'MODEL_OUTPUT_LIMIT_EXCEEDED') {
      delete context.state.draft;
      context.state.assessment = Object.freeze({
        status: 'rejected',
        reason: SESSION_COMPACTION_REJECTION_REASON.GENERATION_LIMIT,
        cause,
      });
      return;
    }
    if (
      cause instanceof ModelInvocationError ||
      cause instanceof AgentActorError ||
      cause instanceof ActorError
    ) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_RUNTIME_FAILED',
        'Compaction invocation failed without an automatic provider retry.',
        { cause }
      );
    }
    throw new AgentSessionError('SESSION_COMPACTION_RUNTIME_FAILED', 'Compaction runtime failed.', {
      cause,
    });
  }
}
