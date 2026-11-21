import type {
  AgentObservabilityErrorCode,
  AgentTraceEmitter,
  AgentTraceEnvelope,
  AgentTraceEvent,
  AgentTraceEventDetails,
  AgentTraceEventSink,
  AgentTraceRuntimeOptions,
  AgentTraceSinkFailure,
  AgentTraceSinkFailureReporter,
  CreateAgentTraceEmitterOptions,
  OutputPublicationStage,
  RequestReplayTraceStatus,
} from '@print-an-agent/base-observability';

// Compile-only consumers qualify inferred literals, readonly fields and discriminated narrowing.
export function qualifyPublicTypes(
  event: AgentTraceEvent,
  details: AgentTraceEventDetails,
  emitter: AgentTraceEmitter,
  options: CreateAgentTraceEmitterOptions,
  failure: AgentTraceSinkFailure,
  errorCode: AgentObservabilityErrorCode
): void {
  const envelope: AgentTraceEnvelope = event;
  const version: 2 = envelope.schemaVersion;
  const runtimeOptions: AgentTraceRuntimeOptions = options;
  const sink: AgentTraceEventSink = { record: () => Promise.resolve() };
  const reporter: AgentTraceSinkFailureReporter = () => Promise.resolve();
  const stage: OutputPublicationStage = 'write';
  const status: RequestReplayTraceStatus = 'claimed';
  if (event.type === 'model-response-completed') {
    if (event.provenanceKind === 'provider-model') {
      const provider: string = event.provider;
      // @ts-expect-error Opaque Engine provenance is absent from provider events.
      void event.provenanceType;
      void provider;
    } else {
      const provenanceType: string = event.provenanceType;
      // @ts-expect-error Provider identity is absent from Engine-defined provenance.
      void event.provider;
      void provenanceType;
    }
  }
  if (details.type === 'agent-run-started') {
    const parentRunId: string | undefined = details.parentRunId;
    void parentRunId;
  }
  // @ts-expect-error Event metadata is readonly.
  event.agentRunId = 'changed';
  // @ts-expect-error Explicit undefined is not an absent optional field.
  const undefinedParent: AgentTraceEventDetails = {
    type: 'agent-run-started',
    operationName: 'test',
    parentRunId: undefined,
  };
  // @ts-expect-error Closed publication vocabulary is inferred from runtime options.
  const invalidStage: OutputPublicationStage = 'flush';
  // @ts-expect-error Closed replay vocabulary is inferred from runtime options.
  const invalidStatus: RequestReplayTraceStatus = 'new';
  void [
    version,
    runtimeOptions,
    sink,
    reporter,
    stage,
    status,
    emitter,
    failure,
    errorCode,
    undefinedParent,
    invalidStage,
    invalidStatus,
  ];
}
