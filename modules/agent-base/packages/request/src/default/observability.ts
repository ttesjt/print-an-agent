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
  await context.agentContext.traceEmitter?.record({
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
  await context.agentContext.traceEmitter?.record({
    type: 'request-replay-resolved',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    status,
  });
}

export async function traceExecutionTargetResolved(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  if (context.target === undefined) return;
  await context.agentContext.traceEmitter?.record({
    type: 'execution-target-resolved',
    ...workflowReference(context),
    provider: context.target.reference.provider,
    model: context.target.reference.model,
    toolsSupported: context.target.capabilities.tools,
  });
}

export async function traceToolsResolved(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.tools === undefined) return;
  const policy = context.resources.toolExecutionPolicy;
  await context.agentContext.traceEmitter?.record({
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
  await context.agentContext.traceEmitter?.record({
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
  await context.agentContext.traceEmitter?.record({
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
  await context.agentContext.traceEmitter?.record({
    type: 'output-publication-failed',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    replayed: context.replayedOutput ?? false,
    stage,
    errorCode: 'REQUEST_OUTPUT_FAILED',
  });
}

export async function traceAgentLoopStarted(context: DefaultRequestWorkflowContext): Promise<void> {
  if (context.session === undefined || context.target === undefined) return;
  context.providerTurnCount = 0;
  await context.agentContext.traceEmitter?.record({
    type: 'agent-loop-started',
    ...workflowReference(context),
    sessionId: context.session.sessionId,
    provider: context.target.reference.provider,
    model: context.target.reference.model,
    maxProviderTurns: context.policy.maxProviderTurns,
    maxOutputCharacters: context.policy.maxOutputCharacters,
  });
}

async function traceModelResponse(
  context: DefaultRequestWorkflowContext,
  message: AssistantModelMessage
): Promise<void> {
  await context.agentContext.traceEmitter?.record({
    type: 'model-response-completed',
    ...workflowReference(context),
    turnIndex: context.providerTurnCount ?? 0,
    provider: message.provider,
    model: message.model,
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
    context.providerTurnCount = (context.providerTurnCount ?? 0) + 1;
    await context.agentContext.traceEmitter?.record({
      type: 'provider-turn-started',
      ...workflowReference(context),
      turnIndex: context.providerTurnCount,
    });
    return;
  }
  if (event.type === 'turn-end') {
    await context.agentContext.traceEmitter?.record({
      type: 'provider-turn-completed',
      ...workflowReference(context),
      turnIndex: context.providerTurnCount ?? 0,
    });
    return;
  }
  if (event.type === 'tool-call-start') {
    await context.agentContext.traceEmitter?.record({
      type: 'tool-call-started',
      ...workflowReference(context),
      callId: event.callId,
      toolName: event.toolName,
    });
    return;
  }
  if (event.type === 'tool-call-end') {
    await context.agentContext.traceEmitter?.record({
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
    providerTurns: context.providerTurnCount ?? 0,
    toolCalls: inspection?.records.length ?? 0,
    totalToolResultCharacters: inspection?.totalResultCharacters ?? 0,
  } as const;
}

export async function traceAgentLoopCompleted(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  await context.agentContext.traceEmitter?.record({
    type: 'agent-loop-completed',
    ...workflowReference(context),
    ...toolSummary(context),
  });
}

export async function traceAgentLoopFailed(
  context: DefaultRequestWorkflowContext,
  error: unknown
): Promise<void> {
  await context.agentContext.traceEmitter?.record({
    type: 'agent-loop-failed',
    ...workflowReference(context),
    ...toolSummary(context),
    errorCode: traceErrorCode(error),
  });
}
