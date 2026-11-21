import { expect, it } from 'vitest';
import {
  defineActor,
  defineActorEngineCapabilities,
  parseActorEngineId,
  requireCompletionCapability,
  resolveActor,
  type ActorDirectHandler,
} from '@print-an-agent/model-invocation-core';

it('validates the completion budget before reading a borrowed handler and rejects lookup failures asynchronously', async () => {
  const failure = new Error('handler lookup failed');
  let lookups = 0;
  const definition = defineActor({ id: 'actor', engineId: 'engine' });
  const actor = requireCompletionCapability(
    resolveActor(definition, {
      id: parseActorEngineId('engine'),
      capabilities: defineActorEngineCapabilities({
        invocationModes: ['direct'],
        inputMediaTypes: ['text'],
        toolCalling: false,
        structuredOutput: false,
        cancellation: true,
      }),
      get complete(): ActorDirectHandler {
        lookups += 1;
        throw failure;
      },
    })
  );
  const request = {
    instructions: '',
    messages: [],
    maxOutputCharacters: 0,
    signal: new AbortController().signal,
  };
  await expect(actor.complete(request)).rejects.toMatchObject({
    code: 'MODEL_RUNTIME_PROTOCOL_INVALID',
  });
  expect(lookups).toBe(0);
  const work = actor.complete({ ...request, maxOutputCharacters: 1 });
  await expect(work).rejects.toBe(failure);
  expect(lookups).toBe(1);
});
