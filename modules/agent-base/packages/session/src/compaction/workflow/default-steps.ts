import { AgentActorError, SESSION_COMPACTION_RESPONSIBILITY_ID } from '@ta-agent/base-actor';
import type { ContextModelMessage, ModelMessage } from '@ta-agent/base-model';
import type { StepOverrides } from '@ta-agent/base-workflow';
import { AgentSessionError } from '../../errors.js';
import { supportsSessionExecution } from '../../lifecycle/execution.js';
import { parseSessionBranchId, parseSessionId } from '../../identifiers.js';
import { selectSessionCompactionSource } from '../source-selection.js';
import type { SessionCompactionStepName } from './names.js';
import type { SessionCompactionWorkflowContext } from './types.js';

function requireSnapshot(context: SessionCompactionWorkflowContext) {
  if (context.snapshot === undefined) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction context is missing its authoritative Session snapshot.'
    );
  }
  return context.snapshot;
}

async function inspectSession(context: SessionCompactionWorkflowContext): Promise<void> {
  const reference = {
    agentId: context.agentRunContext.identity.id,
    sessionId: parseSessionId(context.agentRunContext.input.sessionId),
  };
  if (supportsSessionExecution(context.resources.session)) {
    context.execution = await context.resources.session.acquireSessionExecution(reference);
  }
  const snapshot = await context.resources.session.inspect(reference);
  if (snapshot === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${reference.sessionId}" does not exist for agent "${reference.agentId}".`
    );
  }
  const branchId =
    context.agentRunContext.input.branchId === undefined
      ? snapshot.navigation.selectedBranchId
      : parseSessionBranchId(context.agentRunContext.input.branchId);
  const compaction = await context.resources.session.readCompaction({ ...reference, branchId });
  context.snapshot = snapshot;
  context.branchId = branchId;
  if (compaction !== undefined) context.previousCompaction = compaction;
}

function selectCompactionSource(context: SessionCompactionWorkflowContext): Promise<void> {
  const selection = selectSessionCompactionSource(
    requireSnapshot(context),
    context.branchId ?? requireSnapshot(context).navigation.selectedBranchId,
    context.previousCompaction,
    context.resources.policy
  );
  if (selection.status === 'skipped') {
    context.result = Object.freeze({
      status: 'skipped',
      sessionId: context.agentRunContext.input.sessionId,
      branchId: context.branchId ?? requireSnapshot(context).navigation.selectedBranchId,
      reason: 'not-needed',
    });
  } else {
    context.source = selection.source;
  }
  return Promise.resolve();
}

function readClock(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction clock must return a non-negative safe integer.'
    );
  }
  return timestamp;
}

function buildCompactionMessages(
  source: NonNullable<SessionCompactionWorkflowContext['source']>
): readonly ModelMessage[] {
  const lastTimestamp =
    source.turns.at(-1)?.assistantMessage.timestamp ?? source.previousContext?.timestamp ?? 0;
  return Object.freeze([
    ...(source.previousContext === undefined ? [] : [source.previousContext]),
    ...source.turns.flatMap((turn) => [turn.userMessage, turn.assistantMessage]),
    Object.freeze({
      role: 'user' as const,
      text: 'Produce the compacted session context.',
      timestamp: lastTimestamp,
    }),
  ]);
}

async function buildCompactedContext(context: SessionCompactionWorkflowContext): Promise<void> {
  if (context.result !== undefined) return;
  const source = context.source;
  if (source === undefined) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction source was not selected.'
    );
  }
  const timeoutSignal = AbortSignal.timeout(context.resources.policy.timeoutMilliseconds);
  const signal = AbortSignal.any([context.signal, timeoutSignal]);
  let text: string;
  try {
    const responsibility = await context.resources.responsibilities.resolve(
      SESSION_COMPACTION_RESPONSIBILITY_ID
    );
    context.responsibility = responsibility;
    await context.agentRunContext.traceEmitter?.record({
      type: 'actor-resolved',
      workflowName: context.workflowName,
      workflowRunId: context.workflowRunId,
      responsibilityId: responsibility.id,
      responsibilityRevision: responsibility.catalogRevision,
      actorId: responsibility.actor.id,
      actorRevision: responsibility.actor.catalogRevision,
      engineId: responsibility.actor.engineId,
      candidateIndex: responsibility.candidateIndex,
      invocationMode: 'direct',
    });
    const result = await responsibility.complete({
      instructions: context.resources.instructions,
      messages: buildCompactionMessages(source),
      maxOutputCharacters: context.resources.policy.maxContextCharacters,
      signal,
    });
    text = result.message.text;
  } catch (cause: unknown) {
    if (timeoutSignal.aborted && !context.signal.aborted) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_TIMEOUT',
        `Session compaction exceeded ${context.resources.policy.timeoutMilliseconds} milliseconds.`,
        { cause }
      );
    }
    if (context.signal.aborted) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_CANCELLED',
        'Session compaction was cancelled.',
        { cause }
      );
    }
    if (cause instanceof AgentActorError) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_RUNTIME_FAILED',
        'Session compaction Responsibility could not complete the invocation.',
        { cause }
      );
    }
    throw new AgentSessionError(
      'SESSION_COMPACTION_RUNTIME_FAILED',
      'Session compaction runtime failed.',
      { cause }
    );
  }
  if (
    typeof text !== 'string' ||
    text.trim().length === 0 ||
    text.length > context.resources.policy.maxContextCharacters
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_OUTPUT_INVALID',
      `Compacted context must contain 1-${context.resources.policy.maxContextCharacters} characters.`
    );
  }
  context.compactedContext = Object.freeze({
    role: 'context',
    text,
    timestamp: readClock(context.resources.clock),
  }) satisfies ContextModelMessage;
}

async function persistCompaction(context: SessionCompactionWorkflowContext): Promise<void> {
  if (context.result !== undefined) return;
  const source = context.source;
  const compactedContext = context.compactedContext;
  if (source === undefined || compactedContext === undefined) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction persistence requires a source and compacted context.'
    );
  }
  const committed = await context.resources.session.commitCompaction({
    agentId: source.agentId,
    sessionId: source.sessionId,
    branchId: source.branchId,
    expectedRevision: source.expectedRevision,
    throughTurnId: source.throughTurnId,
    context: compactedContext,
    ...(context.execution === undefined ? {} : { execution: context.execution }),
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

export function createDefaultSessionCompactionStepOverrides(): StepOverrides<
  SessionCompactionStepName,
  SessionCompactionWorkflowContext
> {
  return Object.freeze({
    inspectSession,
    selectCompactionSource,
    buildCompactedContext,
    persistCompaction,
  });
}
