import { AgentRequestError } from '../errors.js';
import { ActorError, ModelInvocationError } from '@ta-agent/model-invocation-core';
import { AgentToolError } from '@ta-agent/base-tool';
import { AgentActorError } from '@ta-agent/base-actor';
import type { OutputFailure } from '../contracts.js';
import type { SessionlessOutputOutcome, SessionlessOutputSink } from './contracts.js';
import type { SessionlessValidatedRequest } from './contracts.js';
import type { ActorDirectResult } from '@ta-agent/model-invocation-core';
import { requireValue } from '../preparation/state-value.js';

export async function openSessionlessOutput(context: {
  readonly workflowRunId: string;
  readonly state: { readonly request?: SessionlessValidatedRequest };
}): Promise<void> {
  const sink = requireValue(context.state.request, 'request').outputSink;
  await publishOutput(
    sink === undefined ? undefined : () => sink.open({ workflowRunId: context.workflowRunId }),
    'open'
  );
}

export async function completeSessionlessResponse<T extends ActorDirectResult>(context: {
  readonly signal: AbortSignal;
  readonly state: {
    readonly request?: SessionlessValidatedRequest;
    readonly response?: T;
    outputOutcome?: SessionlessOutputOutcome;
  };
  result: T | undefined;
}): Promise<void> {
  const response = requireValue(context.state.response, 'response');
  const sink = requireValue(context.state.request, 'request').outputSink;
  context.signal.throwIfAborted();
  await publishOutput(sink === undefined ? undefined : () => sink.close(response), 'close');
  if (sink !== undefined) context.state.outputOutcome = 'closed';
  context.signal.throwIfAborted();
  context.result = response;
}

export function validateSessionlessOutputSink(value: SessionlessOutputSink): SessionlessOutputSink {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.open !== 'function' ||
    typeof value.write !== 'function' ||
    typeof value.close !== 'function' ||
    typeof value.fail !== 'function'
  ) {
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Sessionless output factory must return an output channel.'
    );
  }
  return value;
}

export async function publishOutput(
  operation: (() => Promise<void>) | undefined,
  stage: string
): Promise<void> {
  try {
    await operation?.();
  } catch (cause: unknown) {
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', `Sessionless output failed to ${stage}.`, {
      cause,
    });
  }
}

export function sessionlessOutputFailure(error: unknown): OutputFailure {
  return Object.freeze({
    code:
      error instanceof AgentRequestError ||
      error instanceof AgentActorError ||
      error instanceof ActorError ||
      error instanceof ModelInvocationError ||
      error instanceof AgentToolError
        ? error.code
        : 'REQUEST_FAILED',
    message: 'Request execution failed.',
  });
}
