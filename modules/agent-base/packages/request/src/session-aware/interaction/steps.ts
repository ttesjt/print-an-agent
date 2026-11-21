import {
  AgentSessionError,
  defineSessionTurnPresentation,
  supportsSessionPresentation,
} from '@print-an-agent/base-session';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { type StepOverrides } from '@print-an-agent/workflow-core';
import { AgentRequestError } from '../../errors.js';
import {
  invokeRequestInteraction,
  requireInteraction,
  requireInteractionEvent,
} from '../../interaction/index.js';
import {
  deliverReasoningDelta as writeReasoningDelta,
  deliverTextDelta as writeTextDelta,
} from '../../output/index.js';
import { requireValue } from '../../state-access.js';
import { traceOutputFailed, traceOutputStarted } from '../tracing.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';
import type { RequestStepName } from '../workflow/index.js';
import { buildTurnPresentation, captureReasoningPresentation } from './presentation.js';
import { runAgentInteraction } from './run.js';

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
      requestId: context.state.requestId,
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
  await context.state.contextMemory?.settle();
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
    requestId: context.state.requestId,
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
