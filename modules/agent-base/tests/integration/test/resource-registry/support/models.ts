import {
  createActor,
  requireCompletionCapability,
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  createTextEmbedder,
  type ActorDirectRequest,
  type TextEmbeddingRequest,
  type TextEmbeddingVector,
} from '@ta-agent/model-invocation-core';
import type { ModelEditOperation } from '@ta-agent/context-memory';

export function instruction(request: ActorDirectRequest): string {
  const payload: unknown = JSON.parse(request.messages[0]?.text ?? 'null');
  if (payload === null || typeof payload !== 'object') throw new Error('Missing planner input');
  return 'instruction' in payload && typeof payload.instruction === 'string'
    ? payload.instruction
    : 'observed';
}

/** Real public capability protocols, with deterministic controllable model implementations. */
export function modelFixture(
  options: {
    plan?: (
      request: ActorDirectRequest
    ) => readonly ModelEditOperation[] | Promise<readonly ModelEditOperation[]>;
    embed?: (request: TextEmbeddingRequest) => Promise<readonly TextEmbeddingVector[]>;
    releaseCompletion?: () => void | Promise<void>;
    releaseEmbedding?: () => void | Promise<void>;
  } = {}
) {
  const completions: ActorDirectRequest[] = [];
  const embeddings: TextEmbeddingRequest[] = [];
  let active = 0;
  const created = { completion: 0, embedding: 0 };
  const released = { completion: 0, embedding: 0 };
  const completion = requireCompletionCapability(
    createActor({
      id: 'rr5-planner',
      invocationPolicy: { timeoutMilliseconds: null },
      engine: {
        id: 'rr5-deterministic',
        capabilities: {
          invocationModes: ['direct'],
          inputMediaTypes: ['text'],
          cancellation: true,
          toolCalling: false,
          structuredOutput: false,
        },
        complete: async (request) => {
          completions.push(request);
          active++;
          try {
            const operations = await (options.plan?.(request) ?? [
              { op: 'add', content: instruction(request) },
            ]);
            request.signal.throwIfAborted();
            return {
              message: defineAssistantModelMessage({
                role: 'assistant',
                text: JSON.stringify(operations),
                stopReason: 'stop',
                timestamp: 0,
                provenance: defineEngineDefinedModelExecutionProvenance({
                  type: 'rr5-fixture',
                  evidence: {},
                }),
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  totalTokens: 0,
                },
              }),
            };
          } finally {
            active--;
          }
        },
      },
    })
  );
  const embedding = createTextEmbedder({
    representation: {
      modelRef: 'rr5:model:v1',
      dimensions: 4,
      preprocessingRef: 'identity:v1',
      documentRecipeRef: 'document:v1',
      queryRecipeRef: 'query:v1',
      outputTransformRef: 'identity:v1',
    },
    limits: { maxBatchSize: 16, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    invocationPolicy: { timeoutMilliseconds: null },
    embed: async (request) => {
      embeddings.push(request);
      active++;
      try {
        return await (options.embed?.(request) ??
          Promise.resolve(
            request.inputs.map((input) => ({
              id: input.id,
              vector: input.text.includes('coffee') ? [0, 1, 0, 0] : [1, 0, 0, 0],
            }))
          ));
      } finally {
        active--;
      }
    },
  });
  return {
    completion,
    embedding,
    completions,
    embeddings,
    created,
    released,
    get active() {
      return active;
    },
    recipes: {
      completion: () => {
        created.completion++;
        return {
          value: completion,
          release: async () => {
            released.completion++;
            await options.releaseCompletion?.();
          },
        };
      },
      embedding: () => {
        created.embedding++;
        return {
          value: embedding,
          release: async () => {
            released.embedding++;
            await options.releaseEmbedding?.();
          },
        };
      },
    },
  };
}
