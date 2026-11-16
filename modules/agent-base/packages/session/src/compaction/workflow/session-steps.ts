import { AgentSessionError } from '../../errors.js';
import { supportsSessionExecution } from '../../lifecycle/execution.js';
import { parseSessionBranchId, parseSessionId } from '../../identifiers.js';
import { selectSessionCompactionSource } from '../source-selection.js';
import {
  resolveSessionCompactionCounter,
  measureSessionCompactionText,
} from '../planning/measurement.js';
import { resolveSessionCompactionTarget } from '../planning/target.js';
import { requireCompactionState } from './guards.js';
import type { SessionCompactionWorkflowContext } from './types.js';

export async function inspectSession(context: SessionCompactionWorkflowContext): Promise<void> {
  const reference = {
    agentId: context.state.agentRun.identity.id,
    sessionId: parseSessionId(context.state.agentRun.input.sessionId),
  };
  if (supportsSessionExecution(context.resources.session)) {
    context.state.execution = await context.resources.session.acquireSessionExecution(reference);
  }
  const snapshot = await context.resources.session.inspect(reference);
  if (snapshot === undefined)
    throw new AgentSessionError('SESSION_NOT_FOUND', 'Compaction Session does not exist.');
  const branchId =
    context.state.agentRun.input.branchId === undefined
      ? snapshot.navigation.selectedBranchId
      : parseSessionBranchId(context.state.agentRun.input.branchId);
  const compaction = await context.resources.session.readCompaction({ ...reference, branchId });
  context.state.snapshot = snapshot;
  context.state.branchId = branchId;
  if (compaction !== undefined) context.state.previousCompaction = compaction;
}

export function selectCompactionSource(context: SessionCompactionWorkflowContext): Promise<void> {
  const snapshot = requireCompactionState(context, 'snapshot');
  const branchId = requireCompactionState(context, 'branchId');
  const selection = selectSessionCompactionSource(
    snapshot,
    branchId,
    context.state.previousCompaction,
    context.resources.policy
  );
  if (selection.status === 'skipped') {
    context.result = Object.freeze({
      status: 'skipped',
      sessionId: snapshot.sessionId,
      branchId,
      reason: 'not-needed',
    });
  } else context.state.source = selection.source;
  return Promise.resolve();
}

export function resolveCompactionTarget(context: SessionCompactionWorkflowContext): Promise<void> {
  const { policy } = context.resources;
  const target = resolveSessionCompactionTarget(
    policy.maxContextTokens,
    policy.target,
    context.state.agentRun.input.target
  );
  if (target < policy.minimumTargetTokens)
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Target is below the minimum planner target.'
    );
  context.state.targetTokens = target;
  context.state.plannerTargetTokens = target;
  return Promise.resolve();
}

export async function resolveCompactionTokenCounter(
  context: SessionCompactionWorkflowContext
): Promise<void> {
  context.state.tokenCounter = await resolveSessionCompactionCounter(
    context.resources,
    context.signal
  );
}

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
    context.state.agentRun.input.target
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
  context.result = Object.freeze({
    status: 'compacted',
    sessionId: committed.sessionId,
    branchId: committed.branchId,
    revision: committed.revision,
    throughTurnId: committed.throughTurnId,
    compactedTurnCount: source.turns.length,
  });
}
