import { FOREGROUND_INTERACTION_RESPONSIBILITY_ID } from '@ta-agent/base-actor';
import type { AgentLoopEvent } from '@ta-agent/base-model';
import { parseSessionId, parseTurnId, supportsSessionExecution } from '@ta-agent/base-session';
import { createBoundedToolRuntime, defineToolPermissionPolicy } from '@ta-agent/base-tool';
import { SKIP_STEP, type StepOverrides } from '@ta-agent/base-workflow';
import type { OutputSink, ValidatedAgentRequest } from '../contracts.js';
import { AgentRequestError } from '../errors.js';
import { createRequestFingerprint } from '../replay/fingerprint.js';
import { parseRequestIdempotencyKey } from '../replay/identifiers.js';
import { RequestReplayFailedError } from '../replay/replay-error.js';
import type { RequestJournalClaim } from '../replay/contracts.js';
import type { RequestStepName } from '../workflow/names.js';
import type { DefaultRequestWorkflowContext } from './context.js';
import { requireValue } from './context-value.js';
import { createInteractionStepOverrides } from '../interaction/steps.js';
import { requireInteraction } from '../interaction/state.js';
import {
  countOutputCharacters,
  traceActorResolved,
  traceOutputCompleted,
  traceOutputFailed,
  traceOutputStarted,
  traceReplayResolved,
  traceSessionResolved,
  traceToolsResolved,
} from './observability.js';

function isOutputSink(value: unknown): value is OutputSink {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<OutputSink>;
  return (
    typeof candidate.open === 'function' &&
    typeof candidate.write === 'function' &&
    typeof candidate.close === 'function' &&
    typeof candidate.fail === 'function'
  );
}

function validateRequest(context: DefaultRequestWorkflowContext): Promise<void> {
  const input: unknown = context.agentRunContext.input;
  if (typeof input !== 'object' || input === null) {
    throw new AgentRequestError('REQUEST_INPUT_INVALID', 'Agent request must be an object.');
  }
  const candidate = input as Partial<{
    message: unknown;
    sessionId: unknown;
    idempotencyKey: unknown;
    outputSink: unknown;
  }>;
  if (
    typeof candidate.message !== 'string' ||
    candidate.message.trim().length === 0 ||
    candidate.message.length > context.policy.maxMessageCharacters
  ) {
    throw new AgentRequestError(
      'REQUEST_INPUT_INVALID',
      `Request message must contain 1-${context.policy.maxMessageCharacters} characters.`
    );
  }
  if (candidate.sessionId !== undefined && typeof candidate.sessionId !== 'string') {
    throw new AgentRequestError('REQUEST_INPUT_INVALID', 'Request sessionId must be a string.');
  }
  if (candidate.idempotencyKey !== undefined && typeof candidate.idempotencyKey !== 'string') {
    throw new AgentRequestError(
      'REQUEST_INPUT_INVALID',
      'Request idempotencyKey must be a string.'
    );
  }
  if (candidate.outputSink !== undefined && !isOutputSink(candidate.outputSink)) {
    throw new AgentRequestError('REQUEST_INPUT_INVALID', 'Request outputSink is invalid.');
  }
  const outputSink = candidate.outputSink ?? context.resources.createOutputSink();
  const sessionId =
    candidate.sessionId === undefined ? undefined : parseSessionId(candidate.sessionId);
  const idempotencyKey =
    candidate.idempotencyKey === undefined
      ? undefined
      : parseRequestIdempotencyKey(candidate.idempotencyKey);
  if (idempotencyKey !== undefined && sessionId === undefined) {
    throw new AgentRequestError(
      'REQUEST_INPUT_INVALID',
      'Request sessionId is required when idempotencyKey is provided.'
    );
  }
  context.request = Object.freeze({
    message: candidate.message,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    outputSink,
  }) satisfies ValidatedAgentRequest;
  return Promise.resolve();
}

async function publishReplayedResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  const response = requireValue(context.response, 'response');
  await traceOutputStarted(context, true);
  context.signal.throwIfAborted();
  try {
    await request.outputSink.open({
      requestId: response.requestId,
      sessionId: response.sessionId,
      branchId: response.branchId,
    });
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'open');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to open replay.', {
      cause,
    });
  }
  context.signal.throwIfAborted();
  try {
    countOutputCharacters(context, response.message.text.length);
    await request.outputSink.write(
      Object.freeze({ type: 'text-delta', delta: response.message.text })
    );
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'write');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to write replay.', {
      cause,
    });
  }
  context.signal.throwIfAborted();
  try {
    await request.outputSink.close(response);
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'close');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to close replay.', {
      cause,
    });
  }
  context.signal.throwIfAborted();
  await traceOutputCompleted(context);
  context.executionSettled = true;
}

async function resolveRequestReplay(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  if (request.idempotencyKey === undefined) return;
  const session = requireValue(context.session, 'session');
  let claim: RequestJournalClaim;
  try {
    claim = await context.resources.requestJournal.claim({
      ...session,
      idempotencyKey: request.idempotencyKey,
      fingerprint: createRequestFingerprint({ message: request.message }),
      requestId: context.agentRunContext.runId,
    });
  } catch (error: unknown) {
    if (error instanceof AgentRequestError && error.code === 'REQUEST_REPLAY_CONFLICT') {
      await traceReplayResolved(context, 'conflict');
    }
    throw error;
  }
  context.requestJournalEntry = claim.entry;
  if (claim.status === 'claimed') {
    context.ownedRequestJournalClaim = claim.entry;
    await traceReplayResolved(context, 'claimed');
    return;
  }
  if (claim.entry.status === 'active') {
    await traceReplayResolved(context, 'active');
    throw new AgentRequestError(
      'REQUEST_REPLAY_IN_PROGRESS',
      `Request "${claim.entry.requestId}" is already active for this idempotency key.`
    );
  }
  if (claim.entry.status === 'failed') {
    await traceReplayResolved(context, 'failed');
    throw new RequestReplayFailedError(claim.entry.failure);
  }
  await traceReplayResolved(context, 'completed');
  context.response = claim.entry.response;
  await publishReplayedResponse(context);
  context.result = claim.entry.response;
}

async function resolveSession(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  context.session = await context.resources.session.resolve({
    agentId: context.agentRunContext.identity.id,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
  });
  if (supportsSessionExecution(context.resources.session)) {
    const execution = await context.resources.session.acquireSessionExecution(context.session);
    context.session = Object.freeze({ ...context.session, execution });
  }
  await traceSessionResolved(context);
}

async function beginRequest(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  const session = requireValue(context.session, 'session');
  const userMessage = Object.freeze({
    role: 'user' as const,
    text: request.message,
    timestamp: context.resources.clock(),
  });
  context.userMessage = userMessage;
  context.turn = await context.resources.session.beginTurn({
    ...session,
    turnId: parseTurnId(context.agentRunContext.runId),
    userMessage,
  });
}

async function resolveExecutionTarget(context: DefaultRequestWorkflowContext): Promise<void> {
  context.responsibility = await context.resources.responsibilities.resolve(
    FOREGROUND_INTERACTION_RESPONSIBILITY_ID
  );
  await traceActorResolved(context);
}

async function resolveInstructions(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  const contributions: string[] = [];
  for (const contributor of context.resources.instructionContributors) {
    const contribution = (await contributor({ request })).trim();
    if (contribution.length > 0) contributions.push(contribution);
  }
  const instructions = contributions.join('\n\n');
  if (instructions.length > context.policy.maxInstructionsCharacters) {
    throw new AgentRequestError(
      'REQUEST_INSTRUCTIONS_INVALID',
      `Resolved instructions exceed ${context.policy.maxInstructionsCharacters} characters.`
    );
  }
  context.instructions = instructions;
}

async function loadSessionContext(context: DefaultRequestWorkflowContext): Promise<void> {
  const session = requireValue(context.session, 'session');
  const turn = requireValue(context.turn, 'turn');
  const snapshot = await context.resources.session.loadContext({
    ...session,
    beforeTurnId: turn.turnId,
  });
  context.history = snapshot.messages;
}

async function buildTools(context: DefaultRequestWorkflowContext): Promise<void> {
  const responsibility = requireValue(context.responsibility, 'responsibility');
  context.tools = createBoundedToolRuntime({
    registry: context.resources.toolRegistry,
    permissionPolicy: defineToolPermissionPolicy({
      responsibility: responsibility.allowedTools,
      actor: responsibility.actor.allowedTools,
      product: context.resources.productToolAllowList,
      runtime: context.resources.runtimeToolAllowList,
    }),
    executionPolicy: context.resources.toolExecutionPolicy,
    signal: context.signal,
    clock: context.resources.clock,
  });
  await traceToolsResolved(context);
}

function buildModelContext(context: DefaultRequestWorkflowContext): Promise<void> {
  requireValue(context.tools, 'tools');
  context.modelRequest = Object.freeze({
    instructions: requireValue(context.instructions, 'instructions'),
    history: requireValue(context.history, 'history'),
    prompt: requireValue(context.userMessage, 'userMessage'),
    tools: requireValue(context.tools, 'tools'),
    maxModelTurns: context.policy.maxModelTurns,
    maxOutputCharacters: context.policy.maxOutputCharacters,
    signal: context.signal,
    emit: (event: AgentLoopEvent) => requireInteraction(context).emit(event),
  });
  return Promise.resolve();
}

async function completeResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  const response = requireValue(context.response, 'response');
  const claim = context.ownedRequestJournalClaim;
  context.signal.throwIfAborted();
  if (claim !== undefined) {
    context.requestJournalEntry = await context.resources.requestJournal.complete({
      agentId: claim.agentId,
      sessionId: claim.sessionId,
      idempotencyKey: claim.idempotencyKey,
      requestId: claim.requestId,
      response,
      ...(context.session?.execution === undefined ? {} : { execution: context.session.execution }),
    });
  }
  context.signal.throwIfAborted();
  try {
    await request.outputSink.close(response);
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'close');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to close.', { cause });
  }
  context.signal.throwIfAborted();
  await traceOutputCompleted(context);
  context.result = response;
  context.executionSettled = true;
}

export function createDefaultRequestStepOverrides(): StepOverrides<
  RequestStepName,
  DefaultRequestWorkflowContext
> {
  return Object.freeze({
    validateRequest,
    resolveSession,
    resolveRequestReplay,
    beginRequest,
    resolveExecutionTarget,
    resolveInstructions,
    loadSessionContext,
    gatherExternalContext: SKIP_STEP,
    buildTools,
    buildModelContext,
    ...createInteractionStepOverrides(),
    completeResponse,
  });
}
