import { defineActorEngine, type ActorEngine } from '@print-an-agent/model-invocation-core';
import type { PiRuntimeHandlers } from './types.js';

export function createPiActorEngine(
  runtime: PiRuntimeHandlers,
  engineId: string,
  maxContextTokens: number
): ActorEngine {
  return defineActorEngine({
    id: engineId,
    capabilities: {
      invocationModes: ['interaction', 'direct', 'stream'],
      inputMediaTypes: ['text'],
      interaction: { streamable: true },
      toolCalling: true,
      structuredOutput: false,
      cancellation: true,
      maxContextTokens,
    },
    interact: (request) => runtime.interact(request),
    complete: (request) => runtime.complete(request),
    stream: (request) => runtime.stream(request),
  });
}
