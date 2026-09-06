import type { AgentLoopEvent, AssistantModelMessage } from '@ta-agent/base-model';
import { traceErrorCode } from '@ta-agent/base-observability';
import type {
  OutputPublicationStage,
  RequestReplayTraceStatus,
} from '@ta-agent/base-observability';
import type { DefaultRequestWorkflowContext } from './context.js';

function workflowReference(context: DefaultRequestWorkflowContext) {
  return {
    workflowName: context.workflowName,
    workflowRunId: context.workflowRunId,
  } as const;
}

export async function traceSessionResolved(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.session === undefined) return;
  await context.agentRunContext.traceEmitter?.record({
    type: 'session-resolved',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    branchId: context.session.branchId,
    navigationRevision: context.session.navigationRevision,
  });
}

export async function traceReplayResolved(
  context: DefaultRequestWorkflowContext,
  status: RequestReplayTraceStatus
): Promise<void> {
  if (context.session === undefined) return;
  await context.agentRunContext.traceEmitter?.record({
    type: 'request-replay-resolved',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    status,
  });
}

export async function traceActorResolved(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.responsibility === undefined) return;
  const responsibility = context.responsibility;
  await context.agentRunContext.traceEmitter?.record({
    type: 'actor-resolved',
    ...workflowReference(context),
    responsibilityId: responsibility.id,
    responsibilityRevision: responsibility.catalogRevision,
    actorId: responsibility.actor.id,
    actorRevision: responsibility.actor.catalogRevision,
    engineId: responsibility.actor.engineId,
    candidateIndex: responsibility.candidateIndex,
    invocationMode: 'interaction',
  });
}

export async function traceToolsResolved(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.tools === undefined) return;
  const policy = context.resources.toolExecutionPolicy;
  await context.agentRunContext.traceEmitter?.record({
    type: 'tools-resolved',
    ...workflowReference(context),
    effectiveToolCount: context.tools.tools.length,
    maxToolCalls: policy.maxToolCalls,
    maxArgumentCharacters: policy.maxArgumentCharacters,
    maxResultCharacters: policy.maxResultCharacters,
    maxTotalResultCharacters: policy.maxTotalResultCharacters,
    toolTimeoutMilliseconds: policy.toolTimeoutMilliseconds,
  });
}

export async function traceOutputStarted(
  context: DefaultRequestWorkflowContext,
  replayed: boolean
): Promise<void> {
  if (context.session === undefined) return;
  context.outputCharacterCount = 0;
  context.replayedOutput = replayed;
  await context.agentRunContext.traceEmitter?.record({
    type: 'output-publication-started',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    replayed,
  });
}

export function countOutputCharacters(
  context: DefaultRequestWorkflowContext,
  characters: number
): void {
  context.outputCharacterCount = (context.outputCharacterCount ?? 0) + characters;
}

export async function traceOutputCompleted(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.session === undefined) return;
  await context.agentRunContext.traceEmitter?.record({
    type: 'output-publication-completed',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    replayed: context.replayedOutput ?? false,
    outputCharacters: context.outputCharacterCount ?? 0,
  });
}

export async function traceOutputFailed(
  context: DefaultRequestWorkflowContext,
  stage: OutputPublicationStage
): Promise<void> {
  if (context.session === undefined) return;
  await context.agentRunContext.traceEmitter?.record({
    type: 'output-publication-failed',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    replayed: context.replayedOutput ?? false,
    stage,
    errorCode: 'REQUEST_OUTPUT_FAILED',
  });
}

export async function traceAgentLoopStarted(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.session === undefined || context.responsibility === undefined) return;
  context.modelTurnCount = 0;
  await context.agentRunContext.traceEmitter?.record({
    type: 'agent-loop-started',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    maxModelTurns: context.policy.maxModelTurns,
    maxOutputCharacters: context.policy.maxOutputCharacters,
  });
}

async function traceModelResponse(
  context: DefaultRequestWorkflowContext,
  message: AssistantModelMessage
): Promise<void> {
  const responsibility = context.responsibility;
  if (responsibility === undefined) return;
  const modelTurnIndex = Math.max(context.modelTurnCount ?? 0, 1);
  context.modelTurnCount = modelTurnIndex;
  const provenance =
    message.provenance.kind === 'provider-model'
      ? {
          provenanceKind: message.provenance.kind,
          provider: message.provenance.provider,
          model: message.provenance.model,
        }
      : {
          provenanceKind: message.provenance.kind,
          provenanceType: message.provenance.type,
        };
  await context.agentRunContext.traceEmitter?.record({
    type: 'model-response-completed',
    ...workflowReference(context),
    modelTurnIndex,
    engineId: responsibility.actor.engineId,
    ...provenance,
    stopReason: message.stopReason,
    inputTokens: message.usage.inputTokens,
    outputTokens: message.usage.outputTokens,
    cacheReadTokens: message.usage.cacheReadTokens,
    cacheWriteTokens: message.usage.cacheWriteTokens,
    totalTokens: message.usage.totalTokens,
    outputCharacters: message.text.length,
  });
}

export async function traceAgentLoopEvent(
  context: DefaultRequestWorkflowContext,
  event: AgentLoopEvent
): Promise<void> {
  if (event.type === 'turn-start') {
    context.modelTurnCount = (context.modelTurnCount ?? 0) + 1;
    await context.agentRunContext.traceEmitter?.record({
      type: 'model-turn-started',
      ...workflowReference(context),
      modelTurnIndex: context.modelTurnCount,
    });
    return;
  }
  if (event.type === 'turn-end') {
    await context.agentRunContext.traceEmitter?.record({
      type: 'model-turn-completed',
      ...workflowReference(context),
      modelTurnIndex: context.modelTurnCount ?? 0,
    });
    return;
  }
  if (event.type === 'tool-call-start') {
    await context.agentRunContext.traceEmitter?.record({
      type: 'tool-call-started',
      ...workflowReference(context),
      callId: event.callId,
      toolName: event.toolName,
    });
    return;
  }
  if (event.type === 'tool-call-end') {
    await context.agentRunContext.traceEmitter?.record({
      type: 'tool-call-completed',
      ...workflowReference(context),
      callId: event.callId,
      toolName: event.toolName,
      status: event.status,
      resultCharacters: event.resultCharacters,
    });
    return;
  }
  if (event.type === 'assistant-complete') await traceModelResponse(context, event.message);
}

function toolSummary(context: DefaultRequestWorkflowContext) {
  const inspection = context.tools?.inspect();
  return {
    modelTurns: context.modelTurnCount ?? 0,
    toolCalls: inspection?.records.length ?? 0,
    totalToolResultCharacters: inspection?.totalResultCharacters ?? 0,
  } as const;
}

export async function traceAgentLoopCompleted(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  await context.agentRunContext.traceEmitter?.record({
    type: 'agent-loop-completed',
    ...workflowReference(context),
    ...toolSummary(context),
  });
}

export async function traceAgentLoopFailed(
  context: DefaultRequestWorkflowContext,
  error: unknown
): Promise<void> {
  await context.agentRunContext.traceEmitter?.record({
    type: 'agent-loop-failed',
    ...workflowReference(context),
    ...toolSummary(context),
    errorCode: traceErrorCode(error),
  });
}
