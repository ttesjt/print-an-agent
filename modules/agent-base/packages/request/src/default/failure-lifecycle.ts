import { AgentActorError } from '@ta-agent/base-actor';
import { AgentModelError } from '@ta-agent/base-model';
import { AgentToolError } from '@ta-agent/base-tool';
import { AgentSessionError } from '@ta-agent/base-session';
import type { OutputFailure } from '../contracts.js';
import { AgentRequestError } from '../errors.js';
import { RequestReplayFailedError } from '../replay/replay-error.js';
import type { DefaultRequestWorkflowContext } from './context.js';

function failureFrom(error: unknown): OutputFailure {
  if (error instanceof RequestReplayFailedError) return error.originalFailure;
  if (
    error instanceof AgentActorError ||
    error instanceof AgentModelError ||
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
  const failure = failureFrom(error);
  try {
    context.tools?.close();
  } catch (cleanupError: unknown) {
    cleanupErrors.push(cleanupError);
  }
  const session = context.session;
  const turn = context.turn;
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
  const journalClaim = context.ownedRequestJournalClaim;
  if (journalClaim !== undefined) {
    try {
      context.requestJournalEntry = await context.resources.requestJournal.fail({
        agentId: journalClaim.agentId,
        sessionId: journalClaim.sessionId,
        idempotencyKey: journalClaim.idempotencyKey,
        requestId: journalClaim.requestId,
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
  const outputSink = context.request?.outputSink;
  if (outputSink !== undefined) {
    try {
      await outputSink.fail(failure);
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'Request cleanup failed.');
  }
}
