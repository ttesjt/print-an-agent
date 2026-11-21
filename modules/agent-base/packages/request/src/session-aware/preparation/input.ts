import { parseSessionId } from '@print-an-agent/base-session';
import { AgentRequestError } from '../../errors.js';
import { validateRequestMessage } from '../../preparation/index.js';
import { parseRequestIdempotencyKey } from '../replay/index.js';
import type { ValidatedAgentRequest } from '../types/input.js';
import type { OutputSink } from '../types/output.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

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

export function validateRequest(context: DefaultRequestWorkflowContext): Promise<void> {
  const input: unknown = context.state.requestInput;
  if (typeof input !== 'object' || input === null) {
    throw new AgentRequestError('REQUEST_INPUT_INVALID', 'Agent request must be an object.');
  }
  const candidate = input as Partial<{
    message: unknown;
    sessionId: unknown;
    idempotencyKey: unknown;
    outputSink: unknown;
  }>;
  const message = validateRequestMessage(
    candidate.message,
    context.resources.policy.maxMessageCharacters
  );
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
    message,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    outputSink,
  }) satisfies ValidatedAgentRequest;
  return Promise.resolve();
}
