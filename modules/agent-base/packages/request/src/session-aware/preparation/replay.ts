import { AgentRequestError } from '../../errors.js';
import { requireValue } from '../../state-access.js';
import { publishReplayedResponse } from '../output/replay.js';
import type { RequestJournalClaim } from '../replay/index.js';
import { createRequestFingerprint, RequestReplayFailedError } from '../replay/index.js';
import { traceReplayResolved } from '../tracing.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export async function resolveRequestReplay(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  if (request.idempotencyKey === undefined) return;
  const session = requireValue(context.state.session, 'session');
  let claim: RequestJournalClaim;
  try {
    claim = await context.resources.requestJournal.claim({
      ...session,
      idempotencyKey: request.idempotencyKey,
      fingerprint: createRequestFingerprint({ message: request.message }),
      requestId: context.state.requestId,
    });
  } catch (error: unknown) {
    if (error instanceof AgentRequestError && error.code === 'REQUEST_REPLAY_CONFLICT') {
      await traceReplayResolved(context, 'conflict');
    }
    throw error;
  }
  context.state.requestJournalEntry = claim.entry;
  if (claim.status === 'claimed') {
    context.state.ownedRequestJournalClaim = claim.entry;
    await traceReplayResolved(context, 'claimed');
    return;
  }
  if (claim.entry.status === 'active') {
    await traceReplayResolved(context, 'active');
    throw new AgentRequestError(
      'REQUEST_REPLAY_IN_PROGRESS',
      `Request "${claim.entry.requestId}" is already active for this idempotency key.`
    );
  }
  if (claim.entry.status === 'failed') {
    await traceReplayResolved(context, 'failed');
    throw new RequestReplayFailedError(claim.entry.failure);
  }
  await traceReplayResolved(context, 'completed');
  context.state.response = claim.entry.response;
  await publishReplayedResponse(context);
  context.state.completedResponse = claim.entry.response;
}
