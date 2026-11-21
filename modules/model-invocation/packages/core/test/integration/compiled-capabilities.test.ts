import { expect, it } from 'vitest';
import {
  TOKEN_MEASUREMENT_ACCURACY,
  TEXT_TOKEN_INPUT_CONTRACT,
  createTokenCounter,
  createActor,
  requireCompletionCapability,
  requireActorTextTokenCounter,
  createTextEmbedder,
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
} from '@print-an-agent/model-invocation-core';

it('composes independent capabilities using only the compiled public entry', async () => {
  const signal = new AbortController().signal;
  const counter = createTokenCounter({
    measurementRef: 'example:characters',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) =>
      Promise.resolve({ tokens: input.text.length, accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT }),
  });
  const actor = requireCompletionCapability(
    createActor({
      id: 'actor',
      instructions: 'base',
      engine: {
        id: 'engine',
        textTokenCounter: counter,
        capabilities: {
          invocationModes: ['direct'],
          inputMediaTypes: ['text'],
          toolCalling: false,
          structuredOutput: false,
          cancellation: true,
        },
        complete: (request) =>
          Promise.resolve({
            message: defineAssistantModelMessage({
              role: 'assistant',
              text: request.instructions,
              timestamp: 1,
              stopReason: 'stop',
              provenance: defineProviderModelExecutionProvenance({
                provider: 'example',
                model: 'model',
              }),
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 2,
              },
            }),
          }),
      },
    })
  );
  const measured = await requireActorTextTokenCounter(actor).measure(
    { kind: 'text', text: 'hello' },
    signal
  );
  expect(measured).toMatchObject({
    tokens: 5,
    measurementRef: 'example:characters',
    scope: 'text',
  });
  const completion = await actor.complete({
    instructions: 'caller',
    messages: [],
    maxOutputCharacters: 100,
    signal,
  });
  expect(completion.message.text).toBe('base\n\ncaller');
  expect(Object.isFrozen(completion.message)).toBe(true);

  const embedder = createTextEmbedder({
    representation: {
      modelRef: 'model:v1',
      dimensions: 2,
      preprocessingRef: 'none',
      documentRecipeRef: 'document:v1',
      queryRecipeRef: 'query:v1',
      outputTransformRef: 'none',
    },
    limits: { maxBatchSize: 2, maxInputUtf8Bytes: 100, maxBatchUtf8Bytes: 200 },
    embed: (request) =>
      Promise.resolve(
        request.inputs.map((input) => ({ id: input.id, vector: [input.text.length, 1] })).reverse()
      ),
  });
  const result = await embedder.embed({
    task: 'document',
    inputs: [
      { id: 'a', text: 'hello' },
      { id: 'b', text: 'world!' },
    ],
    signal,
  });
  expect(result.embeddings.map((value) => value.id)).toEqual(['a', 'b']);
  expect(Object.isFrozen(result.embeddings[0]?.vector)).toBe(true);
});
