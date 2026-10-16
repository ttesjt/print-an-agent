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
  if (context.state.session === undefined) return;
  await context.input.traceEmitter?.record({
    type: 'session-resolved',
    ...workflowReference(context),
    sessionId: context.state.session.sessionId,
    branchId: context.state.session.branchId,
    navigationRevision: context.state.session.navigationRevision,
  });
}

export async function traceReplayResolved(
  context: DefaultRequestWorkflowContext,
  status: RequestReplayTraceStatus
): Promise<void> {
  if (context.state.session === undefined) return;
  await context.input.traceEmitter?.record({
    type: 'request-replay-resolved',
    ...workflowReference(context),
    sessionId: context.state.session.sessionId,
    status,
  });
}

export async function traceActorResolved(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.state.responsibility === undefined) return;
  const responsibility = context.state.responsibility;
  await context.input.traceEmitter?.record({
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
  if (context.state.tools === undefined) return;
  const policy = context.resources.toolExecutionPolicy;
  await context.input.traceEmitter?.record({
    type: 'tools-resolved',
    ...workflowReference(context),
    effectiveToolCount: context.state.tools.tools.length,
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
  if (context.state.session === undefined) return;
  context.state.outputCharacterCount = 0;
  context.state.replayedOutput = replayed;
  await context.input.traceEmitter?.record({
    type: 'output-publication-started',
    ...workflowReference(context),
    sessionId: context.state.session.sessionId,
    replayed,
  });
}

export function countOutputCharacters(
  context: DefaultRequestWorkflowContext,
  characters: number
): void {
  context.state.outputCharacterCount = (context.state.outputCharacterCount ?? 0) + characters;
}

export async function traceOutputCompleted(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.state.session === undefined) return;
  await context.input.traceEmitter?.record({
    type: 'output-publication-completed',
    ...workflowReference(context),
    sessionId: context.state.session.sessionId,
    replayed: context.state.replayedOutput ?? false,
    outputCharacters: context.state.outputCharacterCount ?? 0,
  });
}

export async function traceOutputFailed(
  context: DefaultRequestWorkflowContext,
  stage: OutputPublicationStage
): Promise<void> {
  if (context.state.session === undefined) return;
  await context.input.traceEmitter?.record({
    type: 'output-publication-failed',
    ...workflowReference(context),
    sessionId: context.state.session.sessionId,
    replayed: context.state.replayedOutput ?? false,
    stage,
    errorCode: 'REQUEST_OUTPUT_FAILED',
  });
}

export async function traceAgentLoopStarted(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.state.session === undefined || context.state.responsibility === undefined) return;
  context.state.modelTurnCount = 0;
  await context.input.traceEmitter?.record({
    type: 'agent-loop-started',
    ...workflowReference(context),
    sessionId: context.state.session.sessionId,
    maxModelTurns: context.resources.policy.maxModelTurns,
    maxOutputCharacters: context.resources.policy.maxOutputCharacters,
  });
}

async function traceModelResponse(
  context: DefaultRequestWorkflowContext,
  message: AssistantModelMessage
): Promise<void> {
  const responsibility = context.state.responsibility;
  if (responsibility === undefined) return;
  const modelTurnIndex = Math.max(context.state.modelTurnCount ?? 0, 1);
  context.state.modelTurnCount = modelTurnIndex;
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
  await context.input.traceEmitter?.record({
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
    context.state.modelTurnCount = (context.state.modelTurnCount ?? 0) + 1;
    await context.input.traceEmitter?.record({
      type: 'model-turn-started',
      ...workflowReference(context),
      modelTurnIndex: context.state.modelTurnCount,
    });
    return;
  }
  if (event.type === 'turn-end') {
    await context.input.traceEmitter?.record({
      type: 'model-turn-completed',
      ...workflowReference(context),
      modelTurnIndex: context.state.modelTurnCount ?? 0,
    });
    return;
  }
  if (event.type === 'tool-call-start') {
    await context.input.traceEmitter?.record({
      type: 'tool-call-started',
      ...workflowReference(context),
      callId: event.callId,
      toolName: event.toolName,
    });
    return;
  }
  if (event.type === 'tool-call-end') {
    await context.input.traceEmitter?.record({
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
  const inspection = context.state.tools?.inspect();
  return {
    modelTurns: context.state.modelTurnCount ?? 0,
    toolCalls: inspection?.records.length ?? 0,
    totalToolResultCharacters: inspection?.totalResultCharacters ?? 0,
  } as const;
}

export async function traceAgentLoopCompleted(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  await context.input.traceEmitter?.record({
    type: 'agent-loop-completed',
    ...workflowReference(context),
    ...toolSummary(context),
  });
}

export async function traceAgentLoopFailed(
  context: DefaultRequestWorkflowContext,
  error: unknown
): Promise<void> {
  await context.input.traceEmitter?.record({
    type: 'agent-loop-failed',
    ...workflowReference(context),
    ...toolSummary(context),
    errorCode: traceErrorCode(error),
  });
}
