import { SESSION_COMPACTION_RESPONSIBILITY_ID } from '@print-an-agent/agent-actor';
import type { SessionCompactionWorkflowContext } from '../types.js';

export async function resolveCompactionActor(
  context: SessionCompactionWorkflowContext
): Promise<void> {
  const responsibility = await context.resources.responsibilities.resolve(
    SESSION_COMPACTION_RESPONSIBILITY_ID
  );
  context.state.responsibility = responsibility;
  await context.state.traceEmitter?.record({
    type: 'actor-resolved',
    workflowName: context.workflowName,
    workflowRunId: context.workflowRunId,
    responsibilityId: responsibility.id,
    responsibilityRevision: responsibility.catalogRevision,
    actorId: responsibility.actor.id,
    actorRevision: responsibility.actor.catalogRevision,
    engineId: responsibility.actor.engineId,
    candidateIndex: responsibility.candidateIndex,
    invocationMode: 'direct',
  });
}
