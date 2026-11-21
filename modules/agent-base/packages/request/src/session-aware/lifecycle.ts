import { AgentActorError } from '@print-an-agent/base-actor';
import { AgentSessionError, supportsSessionExecution } from '@print-an-agent/base-session';
import { AgentToolError } from '@print-an-agent/base-tool';
import { ActorError, ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { AgentRequestError } from '../errors.js';
import type { OutputFailure } from '../output/index.js';
import { RequestReplayFailedError } from '../replay/index.js';
import type { DefaultRequestWorkflowContext } from './types/workflow.js';

function failureFrom(error: unknown): OutputFailure {
  if (error instanceof RequestReplayFailedError) return error.originalFailure;
  if (
    error instanceof AgentActorError ||
    error instanceof ActorError ||
    error instanceof ModelInvocationError ||
    error instanceof AgentRequestError ||
    error instanceof AgentToolError ||
    error instanceof AgentSessionError
  ) {
    return Object.freeze({ code: error.code, message: error.message });
  }
  if (error instanceof Error) {
    return Object.freeze({ code: 'REQUEST_FAILED', message: error.message });
  }
  return Object.freeze({ code: 'REQUEST_FAILED', message: 'Request failed.' });
}

export async function failRequest(
  context: DefaultRequestWorkflowContext,
  error: unknown
): Promise<void> {
  const cleanupErrors: unknown[] = [];
  try {
    await context.state.contextMemory?.settle();
  } catch (cleanupError: unknown) {
    cleanupErrors.push(cleanupError);
  }
  const failure = failureFrom(error);
  try {
    context.state.tools?.close();
  } catch (cleanupError: unknown) {
    cleanupErrors.push(cleanupError);
  }
  const session = context.state.session;
  const turn = context.state.turn;
  if (session !== undefined && turn !== undefined) {
    try {
      await context.resources.session.failTurn({
        ...session,
        turnId: turn.turnId,
        failureCode: failure.code,
      });
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
  }
  const journalClaim = context.state.ownedRequestJournalClaim;
  if (journalClaim !== undefined) {
    try {
      context.state.requestJournalEntry = await context.resources.requestJournal.fail({
        agentId: journalClaim.agentId,
        sessionId: journalClaim.sessionId,
        idempotencyKey: journalClaim.idempotencyKey,
        requestId: journalClaim.requestId,
        ...(session?.execution === undefined ? {} : { execution: session.execution }),
        failure: Object.freeze({
          code: failure.code,
          message:
            failure.message.length === 0 ? 'Request failed.' : failure.message.slice(0, 2_048),
        }),
      });
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
  }
  const outputSink = context.state.request?.outputSink;
  if (outputSink !== undefined) {
    try {
      await outputSink.fail(failure);
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
  }
  context.state.executionSettled = cleanupErrors.length === 0;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'Request cleanup failed.');
  }
}

export async function releaseRequestExecution(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  const execution = context.state.session?.execution;
  if (
    execution !== undefined &&
    context.state.executionSettled === true &&
    supportsSessionExecution(context.resources.session)
  ) {
    await context.resources.session.releaseSessionExecution(execution);
  }
}
