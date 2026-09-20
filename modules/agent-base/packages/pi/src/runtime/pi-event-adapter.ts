import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { AgentModelError } from '@ta-agent/base-model';
import type { AgentLoopEvent, AgentLoopRequest, AssistantModelMessage } from '@ta-agent/base-model';
import { AgentToolError } from '@ta-agent/base-tool';
import { toModelMessage } from './pi-message-mapping.js';
import type { PiToolAdapterState } from './pi-tool-adapter.js';

export type PiObservedToolEvent = Extract<
  AgentLoopEvent,
  { type: 'tool-call-start' | 'tool-call-end' }
>;
export type PiToolEventObserver = (event: PiObservedToolEvent) => void;

export interface PiRunState {
  outputCharacters: number;
  modelTurns: number;
  turnTextDeltas: string[];
  readonly toolAdapter: PiToolAdapterState;
  completedMessage?: AssistantModelMessage;
  terminalFailure?: AssistantMessage;
  limitFailure?: AgentModelError;
  modelTurnFailure?: AgentModelError;
  eventSinkFailure?: Error;
}

function normalizeEventSinkFailure(error: unknown): Error {
  return error instanceof Error
    ? error
    : new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'The Agent Loop event sink rejected with a non-Error value.',
        { cause: error }
      );
}

async function handleMessageUpdate(
  request: AgentLoopRequest,
  event: Extract<AgentEvent, { type: 'message_update' }>,
  internalAbort: AbortController,
  state: PiRunState
): Promise<void> {
  const update = event.assistantMessageEvent;
  if (update.type === 'thinking_delta') {
    const block = update.partial.content[update.contentIndex];
    if (block?.type !== 'thinking' || block.redacted === true || update.delta.length === 0) return;
    // Reasoning is live across all model turns; never forward signatures or replay thinking_end.
    await request.emit(Object.freeze({ type: 'reasoning-delta', delta: update.delta }));
    return;
  }
  if (update.type !== 'text_delta') return;

  state.outputCharacters += update.delta.length;
  if (state.outputCharacters > request.maxOutputCharacters) {
    state.limitFailure = new AgentModelError(
      'MODEL_OUTPUT_LIMIT_EXCEEDED',
      `Model output exceeded ${request.maxOutputCharacters} characters.`
    );
    internalAbort.abort();
    throw state.limitFailure;
  }
  state.turnTextDeltas.push(update.delta);
  if (request.tools.tools.length === 0) {
    await request.emit(Object.freeze({ type: 'text-delta', delta: update.delta }));
  }
}

async function handleMessageEnd(
  request: AgentLoopRequest,
  event: Extract<AgentEvent, { type: 'message_end' }>,
  state: PiRunState
): Promise<void> {
  if (event.message.role !== 'assistant') return;
  state.modelTurns += 1;
  if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted') {
    state.terminalFailure = event.message;
    state.turnTextDeltas = [];
    return;
  }
  if (event.message.stopReason === 'toolUse') {
    state.turnTextDeltas = [];
    return;
  }

  const normalized = toModelMessage(event.message);
  if (normalized?.role !== 'assistant') {
    throw new AgentModelError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Provider completed without a valid assistant message.'
    );
  }
  if (request.tools.tools.length > 0) {
    for (const delta of state.turnTextDeltas) {
      await request.emit(Object.freeze({ type: 'text-delta', delta }));
    }
  }
  state.turnTextDeltas = [];
  state.completedMessage = normalized;
  await request.emit(Object.freeze({ type: 'assistant-complete', message: normalized }));
}

function resultCharacterCount(event: Extract<AgentEvent, { type: 'tool_execution_end' }>): number {
  const result: unknown = event.result;
  if (typeof result !== 'object' || result === null || !('content' in result)) return 0;
  const content: unknown = result.content;
  if (!Array.isArray(content)) return 0;
  return content.reduce<number>((total, item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('type' in item) ||
      item.type !== 'text' ||
      !('text' in item) ||
      typeof item.text !== 'string'
    ) {
      return total;
    }
    return total + item.text.length;
  }, 0);
}

async function handleToolEvent(
  request: AgentLoopRequest,
  event: AgentEvent,
  state: PiRunState,
  observeToolEvent: PiToolEventObserver | undefined
): Promise<void> {
  if (event.type === 'tool_execution_start') {
    const normalized = Object.freeze({
      type: 'tool-call-start' as const,
      callId: event.toolCallId,
      toolName: event.toolName,
    });
    observeToolEvent?.(normalized);
    await request.emit(normalized);
    if (!request.tools.tools.some((tool) => tool.name === event.toolName)) {
      throw new AgentToolError(
        'TOOL_NOT_AUTHORIZED',
        `Tool "${event.toolName}" is not authorized for this run.`
      );
    }
    return;
  }
  if (event.type !== 'tool_execution_end') return;
  const resultCharacters = resultCharacterCount(event);
  const normalized = Object.freeze({
    type: 'tool-call-end' as const,
    callId: event.toolCallId,
    toolName: event.toolName,
    status: event.isError ? ('error' as const) : ('success' as const),
    resultCharacters,
  });
  observeToolEvent?.(normalized);
  await request.emit(normalized);
  if (
    event.isError &&
    !state.toolAdapter.attemptedCallIds.has(event.toolCallId) &&
    state.toolAdapter.terminalFailure === undefined
  ) {
    throw new AgentToolError(
      'TOOL_ARGUMENTS_INVALID',
      `Tool "${event.toolName}" arguments were rejected before broker execution.`
    );
  }
}

async function emitLifecycleEvent(request: AgentLoopRequest, event: AgentEvent): Promise<void> {
  if (event.type === 'agent_start') {
    await request.emit(Object.freeze({ type: 'interaction-start' }));
  }
  if (event.type === 'turn_start') await request.emit(Object.freeze({ type: 'turn-start' }));
  if (event.type === 'turn_end') await request.emit(Object.freeze({ type: 'turn-end' }));
  if (event.type === 'agent_end') await request.emit(Object.freeze({ type: 'interaction-end' }));
}

export function createPiEventSink(
  request: AgentLoopRequest,
  internalAbort: AbortController,
  state: PiRunState,
  observeToolEvent?: PiToolEventObserver
): (event: AgentEvent) => Promise<void> {
  return async (event) => {
    try {
      if (event.type === 'message_update') {
        await handleMessageUpdate(request, event, internalAbort, state);
      }
      if (event.type === 'message_end') {
        await handleMessageEnd(request, event, state);
      }
      await handleToolEvent(request, event, state, observeToolEvent);
      await emitLifecycleEvent(request, event);
    } catch (error: unknown) {
      state.eventSinkFailure = normalizeEventSinkFailure(error);
      internalAbort.abort();
      throw state.eventSinkFailure;
    }
  };
}

export function throwTerminalFailure(signal: AbortSignal, failure: AssistantMessage): never {
  const cancelled = failure.stopReason === 'aborted' || signal.aborted;
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
  throw new AgentModelError(
    timedOut
      ? 'MODEL_INVOCATION_TIMEOUT'
      : cancelled
        ? 'MODEL_INVOCATION_CANCELLED'
        : 'MODEL_PROVIDER_FAILED',
    failure.errorMessage ??
      (cancelled ? 'Model invocation was cancelled.' : 'Model provider failed.')
  );
}
