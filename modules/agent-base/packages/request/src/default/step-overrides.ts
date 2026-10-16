import { FOREGROUND_INTERACTION_RESPONSIBILITY_ID } from '@ta-agent/base-actor';
import type { ModelInteractionEvent } from '@ta-agent/model-invocation-core';
import { parseSessionId, parseTurnId, supportsSessionExecution } from '@ta-agent/base-session';
import { createBoundedToolRuntime, defineToolPermissionPolicy } from '@ta-agent/base-tool';
import { SKIP_STEP, type StepOverrides } from '@ta-agent/workflow-core';
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
  const input: unknown = context.input.input;
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
    candidate.message.length > context.resources.policy.maxMessageCharacters
  ) {
    throw new AgentRequestError(
      'REQUEST_INPUT_INVALID',
      `Request message must contain 1-${context.resources.policy.maxMessageCharacters} characters.`
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
  context.state.request = Object.freeze({
    message: candidate.message,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    outputSink,
  }) satisfies ValidatedAgentRequest;
  return Promise.resolve();
}

async function publishReplayedResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const response = requireValue(context.state.response, 'response');
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
  context.state.executionSettled = true;
}

async function resolveRequestReplay(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  if (request.idempotencyKey === undefined) return;
  const session = requireValue(context.state.session, 'session');
  let claim: RequestJournalClaim;
  try {
    claim = await context.resources.requestJournal.claim({
      ...session,
      idempotencyKey: request.idempotencyKey,
      fingerprint: createRequestFingerprint({ message: request.message }),
      requestId: context.input.runId,
    });
  } catch (error: unknown) {
    if (error instanceof AgentRequestError && error.code === 'REQUEST_REPLAY_CONFLICT') {
      await traceReplayResolved(context, 'conflict');
    }
    throw error;
  }
  context.state.requestJournalEntry = claim.entry;
  if (claim.status === 'claimed') {
    context.state.ownedRequestJournalClaim = claim.entry;
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
  context.state.response = claim.entry.response;
  await publishReplayedResponse(context);
  context.result = claim.entry.response;
}

async function resolveSession(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  context.state.session = await context.resources.session.resolve({
    agentId: context.input.identity.id,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
  });
  if (supportsSessionExecution(context.resources.session)) {
    const execution = await context.resources.session.acquireSessionExecution(
      context.state.session
    );
    context.state.session = Object.freeze({ ...context.state.session, execution });
  }
  await traceSessionResolved(context);
}

async function beginRequest(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const session = requireValue(context.state.session, 'session');
  const userMessage = Object.freeze({
    role: 'user' as const,
    text: request.message,
    timestamp: context.resources.clock(),
  });
  context.state.userMessage = userMessage;
  context.state.turn = await context.resources.session.beginTurn({
    ...session,
    turnId: parseTurnId(context.input.runId),
    userMessage,
  });
}

async function resolveExecutionTarget(context: DefaultRequestWorkflowContext): Promise<void> {
  context.state.responsibility = await context.resources.responsibilities.resolve(
    FOREGROUND_INTERACTION_RESPONSIBILITY_ID
  );
  await traceActorResolved(context);
}

async function resolveInstructions(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const contributions: string[] = [];
  for (const contributor of context.resources.instructionContributors) {
    const contribution = (await contributor({ request })).trim();
    if (contribution.length > 0) contributions.push(contribution);
  }
  const instructions = contributions.join('\n\n');
  if (instructions.length > context.resources.policy.maxInstructionsCharacters) {
    throw new AgentRequestError(
      'REQUEST_INSTRUCTIONS_INVALID',
      `Resolved instructions exceed ${context.resources.policy.maxInstructionsCharacters} characters.`
    );
  }
  context.state.instructions = instructions;
}

async function loadSessionContext(context: DefaultRequestWorkflowContext): Promise<void> {
  const session = requireValue(context.state.session, 'session');
  const turn = requireValue(context.state.turn, 'turn');
  const snapshot = await context.resources.session.loadContext({
    ...session,
    beforeTurnId: turn.turnId,
  });
  context.state.history = snapshot.messages;
}

async function buildTools(context: DefaultRequestWorkflowContext): Promise<void> {
  const responsibility = requireValue(context.state.responsibility, 'responsibility');
  context.state.tools = createBoundedToolRuntime({
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
  requireValue(context.state.tools, 'tools');
  context.state.modelRequest = Object.freeze({
    instructions: requireValue(context.state.instructions, 'instructions'),
    history: requireValue(context.state.history, 'history'),
    prompt: requireValue(context.state.userMessage, 'userMessage'),
    tools: requireValue(context.state.tools, 'tools'),
    maxModelTurns: context.resources.policy.maxModelTurns,
    maxOutputCharacters: context.resources.policy.maxOutputCharacters,
    signal: context.signal,
    emit: (event: ModelInteractionEvent) => requireInteraction(context).emit(event),
  });
  return Promise.resolve();
}

async function completeResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const response = requireValue(context.state.response, 'response');
  const claim = context.state.ownedRequestJournalClaim;
  context.signal.throwIfAborted();
  if (claim !== undefined) {
    context.state.requestJournalEntry = await context.resources.requestJournal.complete({
      agentId: claim.agentId,
      sessionId: claim.sessionId,
      idempotencyKey: claim.idempotencyKey,
      requestId: claim.requestId,
      response,
      ...(context.state.session?.execution === undefined
        ? {}
        : { execution: context.state.session.execution }),
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
  context.state.executionSettled = true;
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
