import { AgentSessionError } from '@ta-agent/base-session';
import type { AgentLoopEvent } from '@ta-agent/base-model';
import {
  createDefaultRequestStepOverrides,
  createRequestStepDefinitions,
  type DefaultRequestWorkflowContext,
  type RequestAgentRunContext,
  type AgentResponse,
  type OutputSink,
  type OutputStreamEvent,
  type RequestStepName,
} from '@ta-agent/base-request';
import type {
  ConversationInteractionEventConsumer,
  ConversationToolActivity,
  ConversationSessionAdmission,
  StartConversationInteractionInput,
} from '@ta-agent/ui-contracts';

/** One invocation owns this sink. No presentation state is shared between concurrent runs. */
export class WebStreamSink implements OutputSink {
  modelTurnIndex = 1;
  turnId: string | undefined;
  response: AgentResponse | undefined;
  readonly replayOutput: OutputStreamEvent[] = [];
  readonly tools = new Map<string, ConversationToolActivity>();
  constructor(
    readonly input: StartConversationInteractionInput,
    private readonly consume: ConversationInteractionEventConsumer,
    private readonly labels: Readonly<Record<string, string>>,
    private readonly readAdmission: (
      target: Readonly<{ agentId: string; sessionId: string }>
    ) => Promise<ConversationSessionAdmission>
  ) {}
  async admit(context: DefaultRequestWorkflowContext): Promise<void> {
    if (context.session === undefined || context.turn === undefined)
      throw new Error('Turn admission is unavailable.');
    context.signal.throwIfAborted();
    const admission = await this.readAdmission(context.session);
    context.signal.throwIfAborted();
    this.turnId = context.turn.turnId;
    await this.consume({
      type: 'session-admitted',
      interactionId: this.input.interactionId,
      admission,
    });
  }
  open(): Promise<void> {
    return Promise.resolve();
  }
  write = (event: OutputStreamEvent): Promise<void> => {
    if (this.turnId === undefined) {
      this.replayOutput.push(event);
      return Promise.resolve();
    }
    return this.consume({
      ...event,
      interactionId: this.input.interactionId,
      modelTurnIndex: this.modelTurnIndex,
    });
  };
  close(response: AgentResponse): Promise<void> {
    this.response = response;
    return Promise.resolve();
  }
  fail(): Promise<void> {
    return Promise.resolve();
  }
  async loopEvent(event: AgentLoopEvent): Promise<void> {
    if (event.type !== 'tool-call-start' && event.type !== 'tool-call-end') return;
    const activity: ConversationToolActivity = {
      callId: event.callId,
      modelTurnIndex: this.modelTurnIndex,
      toolLabel: this.labels[event.toolName] ?? 'Tool',
      status: event.type === 'tool-call-start' ? 'pending' : event.status,
      details: [],
    };
    this.tools.set(event.callId, activity);
    await this.consume({
      type: 'tool-activity-updated',
      interactionId: this.input.interactionId,
      activity,
    });
  }
}

export function presentationStepOverrides() {
  const defaults = createDefaultRequestStepOverrides();
  const dispatch = createRequestStepDefinitions<
    RequestAgentRunContext,
    AgentResponse,
    DefaultRequestWorkflowContext
  >().dispatchInteractionEvent.step;
  if (dispatch === undefined) throw new Error('Standard event dispatch is unavailable.');
  const begin = defaults.beginRequest;
  if (typeof begin !== 'function') throw new Error('Standard Turn admission is unavailable.');
  return {
    beginRequest: async (context: DefaultRequestWorkflowContext) => {
      const sink = context.request?.outputSink;
      if (sink instanceof WebStreamSink && sink.input.session !== undefined) {
        const expected = sink.input.session;
        if (
          context.session?.branchId !== expected.branchId ||
          String(context.session.navigationRevision) !== expected.navigationRevision
        ) {
          throw new AgentSessionError(
            'SESSION_NAVIGATION_CONFLICT',
            'Conversation target changed before admission.'
          );
        }
      }
      await begin(context);
      if (sink instanceof WebStreamSink) await sink.admit(context);
    },
    dispatchInteractionEvent: async (context: DefaultRequestWorkflowContext) => {
      const sink = context.request?.outputSink;
      const event = context.interaction?.currentEvent;
      if (sink instanceof WebStreamSink && event !== undefined) {
        sink.modelTurnIndex = Math.max(context.modelTurnCount ?? 0, 1);
        sink.turnId = context.turn?.turnId;
        await sink.loopEvent(event);
      }
      await dispatch(context);
    },
  } satisfies Partial<
    Record<RequestStepName, (context: DefaultRequestWorkflowContext) => Promise<void>>
  >;
}
