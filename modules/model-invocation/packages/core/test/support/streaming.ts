import {
  createActor,
  requireStreamingCapability,
  type ActorStreamingHandler,
  type ActorStreamingRequest,
  type ActorInvocationPolicyInput,
  type ModelGenerationEventSink,
} from '../../src/index.js';

export const STREAM_CAPABILITIES = {
  invocationModes: ['stream'] as const,
  inputMediaTypes: ['text'] as const,
  cancellation: true,
  structuredOutput: false,
  toolCalling: false,
};

export function streamingActor(
  stream: ActorStreamingHandler,
  invocationPolicy?: ActorInvocationPolicyInput
) {
  return requireStreamingCapability(
    createActor({
      id: 'streamer',
      engine: { id: 'stream-engine', capabilities: STREAM_CAPABILITIES, stream },
      ...(invocationPolicy === undefined ? {} : { invocationPolicy }),
    })
  );
}

export function streamingRequest(
  emit: ModelGenerationEventSink = () => Promise.resolve(),
  signal: AbortSignal = new AbortController().signal
): ActorStreamingRequest {
  return {
    instructions: '',
    messages: [],
    maxOutputCharacters: 100,
    maxReasoningCharacters: 100,
    signal,
    emit,
  };
}
