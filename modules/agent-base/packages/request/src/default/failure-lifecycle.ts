import { AgentModelError } from '@ta-agent/base-model';
import { AgentToolError } from '@ta-agent/base-tool';
import type { OutputFailure } from '../contracts.js';
import { AgentRequestError } from '../errors.js';
import type { DefaultRequestWorkflowContext } from './context.js';

function failureFrom(error: unknown): OutputFailure {
  if (
    error instanceof AgentModelError ||
    error instanceof AgentRequestError ||
    error instanceof AgentToolError
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
        failureCode: failureFrom(error).code,
      });
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
  }
  const outputSink = context.request?.outputSink;
  if (outputSink !== undefined) {
    try {
      await outputSink.fail(failureFrom(error));
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'Request cleanup failed.');
  }
}
