import { AgentRequestError } from '../../errors.js';
import { requireValue } from '../../state-access.js';
import { traceOutputCompleted, traceOutputFailed } from '../tracing.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export async function completeResponse(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const response = requireValue(context.state.response, 'response');
  const claim = context.state.ownedRequestJournalClaim;
  context.signal.throwIfAborted();
  if (claim !== undefined) {
    context.state.requestJournalEntry = await context.resources.requestJournal.complete({
      agentId: claim.agentId,
      sessionId: claim.sessionId,
      idempotencyKey: claim.idempotencyKey,
      requestId: claim.requestId,
      response,
      ...(context.state.session?.execution === undefined
        ? {}
        : { execution: context.state.session.execution }),
    });
  }
  context.signal.throwIfAborted();
  try {
    await request.outputSink.close(response);
  } catch (cause: unknown) {
    await traceOutputFailed(context, 'close');
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to close.', { cause });
  }
  context.signal.throwIfAborted();
  await traceOutputCompleted(context);
  context.state.completedResponse = response;
  context.state.executionSettled = true;
}
