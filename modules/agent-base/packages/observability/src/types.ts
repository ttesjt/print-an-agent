export interface AgentTraceEnvelope {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly agentRunId: string;
  readonly sequence: number;
  readonly timestamp: number;
}

interface WorkflowReference {
  readonly workflowName: string;
  readonly workflowRunId: string;
}

interface StepReference extends WorkflowReference {
  readonly stepName: string;
}

export type RequestReplayTraceStatus = 'claimed' | 'completed' | 'active' | 'failed' | 'conflict';

export type OutputPublicationStage = 'open' | 'write' | 'close';

export type AgentTraceEventDetails =
  | Readonly<{ type: 'agent-run-started' }>
  | Readonly<{ type: 'agent-run-completed' }>
  | Readonly<{ type: 'agent-run-failed'; errorCode: string }>
  | Readonly<{ type: 'workflow-run-started' } & WorkflowReference>
  | Readonly<{ type: 'workflow-run-skipped'; workflowName: string }>
  | Readonly<{ type: 'workflow-run-completed' } & WorkflowReference>
  | Readonly<{ type: 'workflow-run-failed'; errorCode: string } & WorkflowReference>
  | Readonly<{ type: 'step-started' } & StepReference>
  | Readonly<{ type: 'step-skipped' } & StepReference>
  | Readonly<{ type: 'step-completed' } & StepReference>
  | Readonly<{ type: 'step-failed'; errorCode: string } & StepReference>
  | Readonly<
      {
        type: 'session-resolved';
        sessionId: string;
        branchId: string;
        navigationRevision: number;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'session-navigation-applied';
        operation: 'select' | 'fork' | 'rewind';
        sessionId: string;
        selectedBranchId: string;
        affectedBranchId: string;
        navigationRevision: number;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'request-replay-resolved';
        sessionId: string;
        status: RequestReplayTraceStatus;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'execution-target-resolved';
        provider: string;
        model: string;
        toolsSupported: boolean;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'tools-resolved';
        effectiveToolCount: number;
        maxToolCalls: number;
        maxArgumentCharacters: number;
        maxResultCharacters: number;
        maxTotalResultCharacters: number;
        toolTimeoutMilliseconds: number;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'output-publication-started';
        sessionId: string;
        replayed: boolean;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'output-publication-completed';
        sessionId: string;
        replayed: boolean;
        outputCharacters: number;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'output-publication-failed';
        sessionId: string;
        replayed: boolean;
        stage: OutputPublicationStage;
        errorCode: string;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'agent-loop-started';
        sessionId: string;
        provider: string;
        model: string;
        maxProviderTurns: number;
        maxOutputCharacters: number;
      } & WorkflowReference
    >
  | Readonly<{ type: 'provider-turn-started'; turnIndex: number } & WorkflowReference>
  | Readonly<{ type: 'provider-turn-completed'; turnIndex: number } & WorkflowReference>
  | Readonly<
      {
        type: 'tool-call-started';
        callId: string;
        toolName: string;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'tool-call-completed';
        callId: string;
        toolName: string;
        status: 'success' | 'error';
        resultCharacters: number;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'model-response-completed';
        turnIndex: number;
        provider: string;
        model: string;
        stopReason: 'stop' | 'length';
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
        outputCharacters: number;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'agent-loop-completed';
        providerTurns: number;
        toolCalls: number;
        totalToolResultCharacters: number;
      } & WorkflowReference
    >
  | Readonly<
      {
        type: 'agent-loop-failed';
        providerTurns: number;
        toolCalls: number;
        totalToolResultCharacters: number;
        errorCode: string;
      } & WorkflowReference
    >;

type WithTraceEnvelope<T> = T extends AgentTraceEventDetails
  ? Readonly<T & AgentTraceEnvelope>
  : never;

export type AgentTraceEvent = WithTraceEnvelope<AgentTraceEventDetails>;

export interface AgentTraceEventSink {
  record(event: AgentTraceEvent): Promise<void>;
}

export interface AgentTraceSinkFailure {
  readonly event: AgentTraceEvent;
  readonly cause: unknown;
}

export type AgentTraceSinkFailureReporter = (failure: AgentTraceSinkFailure) => Promise<void>;

export interface AgentTraceEmitter {
  readonly agentId: string;
  readonly agentRunId: string;
  record(details: AgentTraceEventDetails): Promise<void>;
}

export interface CreateAgentTraceEmitterOptions {
  readonly agentId: string;
  readonly agentRunId: string;
  readonly sink?: AgentTraceEventSink;
  readonly clock?: () => number;
  readonly onSinkFailure?: AgentTraceSinkFailureReporter;
}

export interface AgentTraceRuntimeOptions {
  readonly sink?: AgentTraceEventSink;
  readonly clock?: () => number;
  readonly onSinkFailure?: AgentTraceSinkFailureReporter;
}

export interface MemoryAgentTraceAdapterOptions {
  readonly maxEvents: number;
}

export interface AgentTraceInspectionOptions {
  readonly agentRunId?: string;
}

export interface AgentTraceSnapshot {
  readonly events: readonly AgentTraceEvent[];
  readonly droppedEvents: number;
}
