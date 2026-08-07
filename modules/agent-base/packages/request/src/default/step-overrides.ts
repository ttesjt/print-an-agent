import type { AgentLoopEvent, AgentLoopResult } from '@ta-agent/base-model';
import { parseSessionId, parseTurnId } from '@ta-agent/base-session';
import { createBoundedToolRuntime } from '@ta-agent/base-tool';
import { SKIP_STEP, type StepOverrides } from '@ta-agent/base-workflow';
import type { OutputSink, ValidatedAgentRequest } from '../contracts.js';
import { AgentRequestError } from '../errors.js';
import { createRequestFingerprint } from '../replay/fingerprint.js';
import { parseRequestIdempotencyKey } from '../replay/identifiers.js';
import { RequestReplayFailedError } from '../replay/replay-error.js';
import type { RequestJournalClaim } from '../replay/contracts.js';
import type { RequestStepName } from '../workflow/names.js';
import type { DefaultRequestWorkflowContext } from './context.js';
import {
  countOutputCharacters,
  traceAgentLoopCompleted,
  traceAgentLoopEvent,
  traceAgentLoopFailed,
  traceAgentLoopStarted,
  traceExecutionTargetResolved,
  traceOutputCompleted,
  traceOutputFailed,
  traceOutputStarted,
  traceReplayResolved,
  traceSessionResolved,
  traceToolsResolved,
} from './observability.js';

function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new AgentRequestError(
      'REQUEST_CONTEXT_INCOMPLETE',
      `Request context is missing required value "${name}".`
    );
  }
  return value;
}

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
  const input: unknown = context.agentContext.input;
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
  try {
    await request.outputSink.open({
      requestId: response.requestId,
      sessionId: response.sessionId,
    });
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'open');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to open replay.', {
      cause,
    });
  }
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
  try {
    await request.outputSink.close(response);
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'close');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to close replay.', {
      cause,
    });
  }
  await traceOutputCompleted(context);
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
      requestId: context.agentContext.runId,
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
    agentId: context.agentContext.identity.id,
    ...(request.sessionId === undefined ? {} : { requestedSessionId: request.sessionId }),
  });
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
    turnId: parseTurnId(context.agentContext.runId),
    userMessage,
  });
}

async function resolveExecutionTarget(context: DefaultRequestWorkflowContext): Promise<void> {
  context.target = await context.resources.modelRuntime.resolveTarget(
    context.resources.modelReference
  );
  await traceExecutionTargetResolved(context);
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
  context.history = await context.resources.session.loadHistory({
    ...session,
    beforeTurnId: turn.turnId,
  });
}

async function buildTools(context: DefaultRequestWorkflowContext): Promise<void> {
  context.tools = createBoundedToolRuntime({
    registry: context.resources.toolRegistry,
    permissionPolicy: context.resources.toolPermissionPolicy,
    executionPolicy: context.resources.toolExecutionPolicy,
    signal: context.signal,
    clock: context.resources.clock,
  });
  await traceToolsResolved(context);
}

function buildModelContext(context: DefaultRequestWorkflowContext): Promise<void> {
  requireValue(context.tools, 'tools');
  context.modelRequest = Object.freeze({
    target: requireValue(context.target, 'target'),
    instructions: requireValue(context.instructions, 'instructions'),
    history: requireValue(context.history, 'history'),
    prompt: requireValue(context.userMessage, 'userMessage'),
    tools: requireValue(context.tools, 'tools'),
    maxProviderTurns: context.policy.maxProviderTurns,
    maxOutputCharacters: context.policy.maxOutputCharacters,
    signal: context.signal,
    emit: (event: AgentLoopEvent) => handleAgentLoopEvent(context, event),
  });
  return Promise.resolve();
}

async function handleAgentLoopEvent(
  context: DefaultRequestWorkflowContext,
  event: AgentLoopEvent
): Promise<void> {
  await traceAgentLoopEvent(context, event);
  if (event.type === 'text-delta') {
    const request = requireValue(context.request, 'request');
    try {
      countOutputCharacters(context, event.delta.length);
      await request.outputSink.write(Object.freeze({ type: 'text-delta', delta: event.delta }));
    } catch (cause: unknown) {
      await traceOutputFailed(context, 'write');
      throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to write.', {
        cause,
      });
    }
    return;
  }
  if (event.type === 'assistant-complete') {
    const session = requireValue(context.session, 'session');
    const turn = requireValue(context.turn, 'turn');
    await context.resources.session.completeTurn({
      ...session,
      turnId: turn.turnId,
      assistantMessage: event.message,
    });
  }
}

async function runAgentInteraction(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  const session = requireValue(context.session, 'session');
  await traceOutputStarted(context, false);
  try {
    await request.outputSink.open({
      requestId: context.agentContext.runId,
      sessionId: session.sessionId,
    });
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'open');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to open.', { cause });
  }
  const tools = requireValue(context.tools, 'tools');
  let result: AgentLoopResult;
  await traceAgentLoopStarted(context);
  try {
    result = await context.resources.modelRuntime.run(
      requireValue(context.modelRequest, 'modelRequest')
    );
  } catch (error: unknown) {
    tools.close();
    await traceAgentLoopFailed(context, error);
    throw error;
  }
  tools.close();
  await traceAgentLoopCompleted(context);
  context.response = Object.freeze({
    requestId: context.agentContext.runId,
    sessionId: session.sessionId,
    message: result.message,
    toolRun: requireValue(context.tools, 'tools').inspect(),
  });
}

async function completeResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.request, 'request');
  const response = requireValue(context.response, 'response');
  const claim = context.ownedRequestJournalClaim;
  if (claim !== undefined) {
    context.requestJournalEntry = await context.resources.requestJournal.complete({
      agentId: claim.agentId,
      sessionId: claim.sessionId,
      idempotencyKey: claim.idempotencyKey,
      requestId: claim.requestId,
      response,
    });
  }
  try {
    await request.outputSink.close(response);
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'close');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to close.', { cause });
  }
  await traceOutputCompleted(context);
  context.result = response;
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
    runAgentInteraction,
    completeResponse,
  });
}
