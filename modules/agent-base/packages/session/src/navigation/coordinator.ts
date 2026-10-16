import { finalizeSessionExecution } from '../lifecycle/workflow-execution.js';
import type {
  SessionNavigationCoordinatorRequest,
  SessionNavigationOperationOptions,
  SessionNavigationOutcome,
} from './contracts.js';
import {
  commitSessionNavigationState,
  inspectSessionNavigationState,
  type SessionNavigationExecutionState,
  validateSessionNavigationState,
} from './coordinator-internal.js';
import { AgentSessionError } from '../errors.js';

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

function resolveSignal(options: SessionNavigationOperationOptions): AbortSignal {
  if (options.signal === undefined) return NEVER_ABORTED_SIGNAL;
  if (!(options.signal instanceof AbortSignal)) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_INVALID',
      'Session navigation signal must be an AbortSignal.'
    );
  }
  return options.signal;
}

/**
 * Executes the complete Session-owned navigation invariant without an Agent runtime or Workflow.
 * Once adapter mutation starts, cooperative cancellation cannot claim that the write was stopped.
 */
export async function executeSessionNavigation(
  request: SessionNavigationCoordinatorRequest,
  options: SessionNavigationOperationOptions = {}
): Promise<SessionNavigationOutcome> {
  const state: SessionNavigationExecutionState = {
    agentId: request.agentId,
    input: request.navigation,
    resources: Object.freeze({ session: request.session }),
  };

  const signal = resolveSignal(options);

  let operationFailed = false;
  let operationError: unknown;
  let result: SessionNavigationOutcome | undefined;
  try {
    validateSessionNavigationState(state, signal);
    result = await inspectSessionNavigationState(state, signal);
    if (result === undefined) result = (await commitSessionNavigationState(state, signal))?.result;
    if (result === undefined) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_INVALID',
        'Session navigation completed without a result.'
      );
    }
  } catch (error: unknown) {
    operationFailed = true;
    operationError = error;
  }

  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    await finalizeSessionExecution(state);
  } catch (error: unknown) {
    cleanupFailed = true;
    cleanupError = error;
  }

  if (operationFailed) {
    if (cleanupFailed) {
      throw new AggregateError(
        [operationError, cleanupError],
        'Session navigation failed and execution cleanup also failed.',
        { cause: operationError }
      );
    }
    throw operationError;
  }
  if (cleanupFailed) throw cleanupError;
  if (result === undefined) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_INVALID',
      'Session navigation completed without a result.'
    );
  }
  return result;
}
