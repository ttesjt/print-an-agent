import { AgentModelError, type AgentLoopEvent } from '@ta-agent/base-model';
import type { StepOverrides } from '@ta-agent/base-workflow';
import type { DefaultRequestWorkflowContext } from '../default/context.js';
import { requireValue } from '../default/context-value.js';
import {
  countOutputCharacters,
  traceAgentLoopCompleted,
  traceAgentLoopEvent,
  traceAgentLoopFailed,
  traceAgentLoopStarted,
  traceOutputFailed,
  traceOutputStarted,
} from '../default/observability.js';
import { AgentRequestError } from '../errors.js';
import type { RequestStepName } from '../workflow/names.js';
import { InteractionEventDelivery } from './event-delivery.js';
import {
  requireInteraction,
  requireInteractionEvent,
  type RequestInteractionState,
} from './state.js';

function accountEvent(context: DefaultRequestWorkflowContext, event: AgentLoopEvent): void {
  if (event.type === 'text-delta') countOutputCharacters(context, event.delta.length);
  const characters =
    event.type === 'assistant-complete'
      ? event.message.text.length
      : (context.outputCharacterCount ?? 0);
  if (characters > context.policy.maxOutputCharacters) {
    throw new AgentModelError(
      'MODEL_OUTPUT_LIMIT_EXCEEDED',
      'Request interaction output exceeded its character budget.'
    );
  }
}

async function runAgentInteraction(context: DefaultRequestWorkflowContext): Promise<void> {
  const delivery = new InteractionEventDelivery({
    signal: context.signal,
    capacity: context.policy.maxPendingInteractionEvents,
    dispatch: async (event) => {
      accountEvent(context, event);
      await traceAgentLoopEvent(context, event);
      delivery.assertHealthy();
      await context.runStep('dispatchInteractionEvent');
    },
  });
  context.interaction = Object.seal({
    signal: delivery.signal,
    emit: delivery.emit,
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
    context.tools?.close();
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
  const request = requireValue(context.request, 'request');
  const session = requireValue(context.session, 'session');
  await traceOutputStarted(context, false);
  const signal = requireInteraction(context).signal;
  if (signal.aborted) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
    throw new AgentModelError(
      timedOut ? 'MODEL_INVOCATION_TIMEOUT' : 'MODEL_INVOCATION_CANCELLED',
      timedOut ? 'Request interaction timed out.' : 'Request interaction was cancelled.'
    );
  }
  try {
    await request.outputSink.open({
      requestId: context.agentRunContext.runId,
      sessionId: session.sessionId,
      branchId: requireValue(context.turn, 'turn').branchId,
    });
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'open');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to open.', { cause });
  }
}

async function invokeActorInteraction(context: DefaultRequestWorkflowContext): Promise<void> {
  const interaction = requireInteraction(context);
  interaction.result = await requireValue(context.responsibility, 'responsibility').interact({
    ...requireValue(context.modelRequest, 'modelRequest'),
    signal: interaction.signal,
    emit: interaction.emit,
  });
}

async function deliverTextDelta(context: DefaultRequestWorkflowContext): Promise<void> {
  const event = requireInteractionEvent(context, 'text-delta');
  try {
    await requireValue(context.request, 'request').outputSink.write(
      Object.freeze({ type: 'text-delta', delta: event.delta })
    );
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'write');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to write.', { cause });
  }
}

async function completeAssistantMessage(context: DefaultRequestWorkflowContext): Promise<void> {
  const event = requireInteractionEvent(context, 'assistant-complete');
  await context.resources.session.completeTurn({
    ...requireValue(context.session, 'session'),
    turnId: requireValue(context.turn, 'turn').turnId,
    assistantMessage: event.message,
  });
}

function buildAgentResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const result = requireValue(requireInteraction(context).result, 'interaction.result');
  context.response = Object.freeze({
    requestId: context.agentRunContext.runId,
    sessionId: requireValue(context.session, 'session').sessionId,
    branchId: requireValue(context.turn, 'turn').branchId,
    message: result.message,
    toolRun: requireValue(context.tools, 'tools').inspect(),
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
    completeAssistantMessage,
    buildAgentResponse,
  });
}
