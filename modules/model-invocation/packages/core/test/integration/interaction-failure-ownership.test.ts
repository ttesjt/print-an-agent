import { requireInteractionCapability } from '../../src/index.js';
import type { ModelInteractionEventSink } from '../../src/index.js';
import { describe, expect, it } from 'vitest';
import { createActorCatalog, parseActorId } from '../../src/index.js';
import { EMPTY_TOOL_RUNTIME } from '../support/actor.js';

describe('Actor failure delivery ownership', () => {
  it.each(['complete', 'fail'] as const)(
    'rejects before consumer drainage when in-flight delivery will %s',
    async (deliveryOutcome) => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const engineFailure = new Error('Engine failed');
      const deliveryFailure = new Error('Delivery failed');
      const calls: string[] = [];
      let engineEmit: ModelInteractionEventSink | undefined;
      const delivery = release.promise.then(() => {
        calls.push('delivery-settled');
        if (deliveryOutcome === 'fail') throw deliveryFailure;
      });
      const catalog = createActorCatalog({
        actors: [{ id: 'main', engineId: 'engine' }],
        engines: [
          {
            id: 'engine',
            capabilities: {
              invocationModes: ['interaction'],
              inputMediaTypes: ['text'],
              interaction: { streamable: true },
              toolCalling: false,
              structuredOutput: false,
              cancellation: true,
            },
            interact: async (request) => {
              engineEmit = request.emit;
              // Intentionally ignored: the protocol must observe this Promise's later rejection.
              void request.emit({ type: 'text-delta', delta: 'partial' });
              await started.promise;
              throw engineFailure;
            },
          },
        ],
      });
      const actor = await catalog.resolve(parseActorId('main'));
      const invocation = requireInteractionCapability(actor).interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'hello', timestamp: 1 },
        tools: EMPTY_TOOL_RUNTIME,
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: (event) => {
          calls.push(event.type);
          started.resolve();
          return delivery;
        },
      });

      try {
        // Rejection must arrive while delivery is deliberately blocked: Actor does not drain here.
        await expect(invocation).rejects.toBe(engineFailure);
        expect(calls).toEqual(['text-delta']);
        if (engineEmit === undefined) throw new Error('Expected Engine emitter.');
        await expect(engineEmit({ type: 'text-delta', delta: 'late' })).rejects.toMatchObject({
          code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
        });
        expect(calls).toEqual(['text-delta']);
      } finally {
        // The consumer, not Actor rejection, owns the delivery resource's remaining lifetime.
        release.resolve();
        await Promise.allSettled([delivery]);
      }

      if (deliveryOutcome === 'fail') await expect(delivery).rejects.toBe(deliveryFailure);
      else await expect(delivery).resolves.toBeUndefined();
      calls.push('consumer-cleanup');
      expect(calls).toEqual(['text-delta', 'delivery-settled', 'consumer-cleanup']);
      // A later delivery failure cannot replace the already-reported Engine failure.
      await expect(invocation).rejects.toBe(engineFailure);
    }
  );
});
