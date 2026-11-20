import { AgentSessionError } from '../../../errors.js';
import { resolveSessionCompactionTarget } from '../../planning/target.js';
import {
  measureSessionCompactionText,
  resolveSessionCompactionCounter,
} from '../../token-measurement.js';
import { requireCompactionState } from '../state-access.js';
import type { SessionCompactionWorkflowContext } from '../types.js';

/** Publication revalidates text rather than trusting mutable planning/assessment fields. */
export async function persistCompaction(context: SessionCompactionWorkflowContext): Promise<void> {
  const source = requireCompactionState(context, 'source');
  const candidate = requireCompactionState(context, 'compactedContext');
  // Detach before async counting: a custom Step may have supplied a mutable context object.
  const compactedContext = Object.freeze({
    role: 'context' as const,
    text: candidate.text,
    timestamp: candidate.timestamp,
  });
  const { policy } = context.resources;
  const tokenCounter = await resolveSessionCompactionCounter(context.resources, context.signal);
  if (
    tokenCounter.descriptor.measurementRef !==
    requireCompactionState(context, 'tokenCounter').descriptor.measurementRef
  )
    throw new AgentSessionError(
      'SESSION_COMPACTION_TOKENIZER_FAILED',
      'The compaction measurement identity changed before publication.'
    );
  const target = resolveSessionCompactionTarget(
    policy.maxContextTokens,
    policy.target,
    context.state.compactionInput.target
  );
  if (
    compactedContext.text.trim().length === 0 ||
    compactedContext.text.length > policy.maxGenerationCharacters
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_OUTPUT_INVALID',
      'Final compaction text is empty or exceeds its safety bound.'
    );
  }
  const tokens = await measureSessionCompactionText(
    compactedContext.text,
    tokenCounter,
    context.signal
  );
  if (tokens > target)
    throw new AgentSessionError(
      'SESSION_COMPACTION_OUTPUT_INVALID',
      'Final compaction text exceeds its token target.'
    );
  context.signal.throwIfAborted();
  const committed = await context.resources.session.commitCompaction({
    agentId: source.agentId,
    sessionId: source.sessionId,
    branchId: source.branchId,
    expectedRevision: source.expectedRevision,
    throughTurnId: source.throughTurnId,
    context: compactedContext,
    ...(context.state.execution === undefined ? {} : { execution: context.state.execution }),
  });
  context.state.outcome = Object.freeze({
    status: 'compacted',
    sessionId: committed.sessionId,
    branchId: committed.branchId,
    revision: committed.revision,
    throughTurnId: committed.throughTurnId,
    compactedTurnCount: source.turns.length,
  });
}
