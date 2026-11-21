import { AgentRequestError } from '../../errors.js';
import { requireValue } from '../../state-access.js';
import {
  countOutputCharacters,
  traceOutputCompleted,
  traceOutputFailed,
  traceOutputStarted,
} from '../tracing.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export async function publishReplayedResponse(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const response = requireValue(context.state.response, 'response');
  await traceOutputStarted(context, true);
  context.signal.throwIfAborted();
  try {
    await request.outputSink.open({
      requestId: response.requestId,
      sessionId: response.sessionId,
      branchId: response.branchId,
    });
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'open');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to open replay.', {
      cause,
    });
  }
  context.signal.throwIfAborted();
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
  context.signal.throwIfAborted();
  try {
    await request.outputSink.close(response);
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'close');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to close replay.', {
      cause,
    });
  }
  context.signal.throwIfAborted();
  await traceOutputCompleted(context);
  context.state.executionSettled = true;
}
