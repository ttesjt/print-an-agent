import { ModelInvocationError } from '@ta-agent/model-invocation-core';
import {
  AgentSessionError,
  defineSessionTurnPresentation,
  supportsSessionPresentation,
} from '@ta-agent/base-session';
import { type StepOverrides } from '@ta-agent/workflow-core';
import { invokeRequestInteraction } from './invoke.js';
import { createInteractionEventAccounting } from './budgets.js';
import type { DefaultRequestWorkflowContext } from '../default/context.js';
import { requireValue } from '../preparation/state-value.js';
import {
  deliverTextDelta as writeTextDelta,
  deliverReasoningDelta as writeReasoningDelta,
} from '../delivery/steps.js';
import {
  traceAgentLoopCompleted,
  traceModelInteractionEvent,
  traceAgentLoopFailed,
  traceAgentLoopStarted,
  traceOutputFailed,
  traceOutputStarted,
} from '../default/observability.js';
import { AgentRequestError } from '../errors.js';
import type { RequestStepName } from '../workflow/names.js';
import { InteractionEventDelivery } from './event-delivery.js';
import { buildTurnPresentation, captureReasoningPresentation } from './presentation.js';
import {
  requireInteraction,
  requireInteractionEvent,
  type RequestInteractionState,
} from './state.js';

async function runAgentInteraction(context: DefaultRequestWorkflowContext): Promise<void> {
  const accountEvent = createInteractionEventAccounting(context);
  const delivery = new InteractionEventDelivery({
    signal: context.signal,
    capacity: context.resources.policy.maxPendingInteractionEvents,
    dispatch: async (event) => {
      accountEvent(event);
      await traceModelInteractionEvent(context, event);
      delivery.assertHealthy();
      await context.runStep('dispatchInteractionEvent');
    },
  });
  context.state.interaction = Object.seal({
    signal: delivery.signal,
    emit: delivery.emit,
    stop: (cause: unknown) => delivery.stop(cause),
    get currentEvent() {
      return delivery.currentEvent;
    },
    result: undefined,
  } satisfies RequestInteractionState);
  let failure: { readonly cause: unknown } | undefined;
  let loopStarted = false;
  let toolsCloseAttempted = false;
  const closeTools = (): void => {
    if (toolsCloseAttempted) return;
    toolsCloseAttempted = true;
    context.state.tools?.close();
  };
  try {
    delivery.assertHealthy();
    await context.runStep('openResponseStream');
    delivery.assertHealthy();
    loopStarted = true;
    await traceAgentLoopStarted(context);
    delivery.assertHealthy();
    await context.runStep('invokeActorInteraction');
    await delivery.finish();
    closeTools();
    await traceAgentLoopCompleted(context);
    loopStarted = false;
    delivery.assertHealthy();
    await context.runStep('buildAgentResponse');
    delivery.assertHealthy();
  } catch (cause: unknown) {
    const error = delivery.stop(cause);
    failure = { cause: error };
    // No OutputSink.fail()/Session failure cleanup can race accepted writes after this drains.
    await delivery.drain();
    if (loopStarted) {
      try {
        await traceAgentLoopFailed(context, error);
      } catch (traceError: unknown) {
        failure = {
          cause: new AggregateError([error, traceError], 'Interaction failure tracing failed.', {
            cause: error,
          }),
        };
      }
    }
  } finally {
    delivery.dispose();
    delete context.state.capturedReasoning;
    delete context.state.turnPresentation;
  }
  try {
    closeTools();
  } catch (cleanupError: unknown) {
    failure = {
      cause:
        failure === undefined
          ? cleanupError
          : new AggregateError(
              [failure.cause, cleanupError],
              'Interaction failed and Tool cleanup also failed.',
              { cause: failure.cause }
            ),
    };
  }
  if (failure !== undefined) throw failure.cause;
}

async function openResponseStream(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const session = requireValue(context.state.session, 'session');
  await traceOutputStarted(context, false);
  const signal = requireInteraction(context).signal;
  if (signal.aborted) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
    throw new ModelInvocationError(
      timedOut ? 'MODEL_INVOCATION_TIMEOUT' : 'MODEL_INVOCATION_CANCELLED',
      timedOut ? 'Request interaction timed out.' : 'Request interaction was cancelled.'
    );
  }
  try {
    await request.outputSink.open({
      requestId: context.input.runId,
      sessionId: session.sessionId,
      branchId: requireValue(context.state.turn, 'turn').branchId,
    });
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'open');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to open.', { cause });
  }
}

async function invokeActorInteraction(context: DefaultRequestWorkflowContext): Promise<void> {
  await invokeRequestInteraction(
    context,
    requireValue(context.state.responsibility, 'responsibility')
  );
}

async function deliverTextDelta(context: DefaultRequestWorkflowContext): Promise<void> {
  await deliverStreamDelta(context, writeTextDelta);
}

async function deliverReasoningDelta(context: DefaultRequestWorkflowContext): Promise<void> {
  await deliverStreamDelta(context, writeReasoningDelta);
}

async function deliverStreamDelta(
  context: DefaultRequestWorkflowContext,
  write: typeof writeTextDelta
): Promise<void> {
  try {
    await write(context);
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'write');
    throw cause;
  }
}

async function completeAssistantMessage(context: DefaultRequestWorkflowContext): Promise<void> {
  const event = requireInteractionEvent(context, 'assistant-complete');
  const request = {
    ...requireValue(context.state.session, 'session'),
    turnId: requireValue(context.state.turn, 'turn').turnId,
    assistantMessage: event.message,
  };
  const session = context.resources.session;
  context.signal.throwIfAborted();
  if (context.state.turnPresentation === undefined) {
    await session.completeTurn(request);
    context.signal.throwIfAborted();
    return;
  }
  if (!supportsSessionPresentation(session)) {
    throw new AgentSessionError(
      'SESSION_PRESENTATION_NOT_CONFIGURED',
      'Session adapter cannot atomically commit turn presentation.'
    );
  }
  const presentation = defineSessionTurnPresentation(context.state.turnPresentation);
  if (
    presentation.reasoningBlocks.reduce((sum, block) => sum + block.text.length, 0) >
    context.resources.policy.maxReasoningCharacters
  ) {
    throw new ModelInvocationError(
      'MODEL_REASONING_LIMIT_EXCEEDED',
      'Reasoning presentation exceeded the request character budget.'
    );
  }
  await session.completeTurnWithPresentation({ ...request, presentation });
  context.signal.throwIfAborted();
}

function buildAgentResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const result = requireValue(requireInteraction(context).result, 'interaction.result');
  context.state.response = Object.freeze({
    requestId: context.input.runId,
    sessionId: requireValue(context.state.session, 'session').sessionId,
    branchId: requireValue(context.state.turn, 'turn').branchId,
    message: result.message,
    toolRun: requireValue(context.state.tools, 'tools').inspect(),
  });
  return Promise.resolve();
}

export function createInteractionStepOverrides(): StepOverrides<
  RequestStepName,
  DefaultRequestWorkflowContext
> {
  return Object.freeze({
    runAgentInteraction,
    openResponseStream,
    invokeActorInteraction,
    deliverTextDelta,
    deliverReasoningDelta,
    captureReasoningPresentation,
    buildTurnPresentation,
    completeAssistantMessage,
    buildAgentResponse,
  });
}
