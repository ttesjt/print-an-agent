import type { ModelInteractionEventSink } from '@ta-agent/model-invocation-core';
import { DEFAULT_REQUEST_POLICY } from '@ta-agent/base-request';
import { describe, expect, it, vi } from 'vitest';
import { interactionAgent, interactionMessage } from '../support/interaction-agent.js';

describe('reasoning delivery lifecycle', () => {
  it.each(['success', 'cancel', 'overflow', 'sink-failure'] as const)(
    'serializes mixed events and owns in-flight reasoning on %s',
    async (mode) => {
      const controller = new AbortController();
      const started = Promise.withResolvers<void>();
      const emitted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const calls: string[] = [];
      let engineEmit: ModelInteractionEventSink | undefined;
      const fixture = await interactionAgent(
        async (request) => {
          engineEmit = request.emit;
          void request.emit({ type: 'reasoning-delta', delta: 'reason' });
          await started.promise;
          void request.emit({ type: 'text-delta', delta: 'AB' });
          if (mode === 'overflow') void request.emit({ type: 'reasoning-delta', delta: 'excess' });
          if (mode === 'cancel') controller.abort();
          const message = interactionMessage();
          void request.emit({ type: 'assistant-complete', message });
          emitted.resolve();
          return { message };
        },
        { requestPolicy: { ...DEFAULT_REQUEST_POLICY, maxPendingInteractionEvents: 2 } }
      );
      const write = fixture.output.write.bind(fixture.output);
      const fail = fixture.output.fail.bind(fixture.output);
      vi.spyOn(fixture.output, 'write').mockImplementation(async (event) => {
        calls.push(`start:${event.type}`);
        if (event.type === 'reasoning-delta') {
          started.resolve();
          await release.promise;
          if (mode === 'sink-failure') throw new Error('sink failed');
        }
        await write(event);
        calls.push(`end:${event.type}`);
      });
      vi.spyOn(fixture.output, 'fail').mockImplementation(async (failure) => {
        calls.push('fail');
        await fail(failure);
      });
      const commit = vi.spyOn(fixture.session, 'completeTurnWithPresentation');
      const close = vi.spyOn(fixture.output, 'close');
      const run = fixture.run(controller.signal);
      const checked =
        mode === 'success'
          ? expect(run).resolves.toMatchObject({ message: { text: 'AB' } })
          : expect(run).rejects.toMatchObject({
              code:
                mode === 'cancel'
                  ? 'MODEL_INVOCATION_CANCELLED'
                  : mode === 'overflow'
                    ? 'REQUEST_INTERACTION_EVENT_QUEUE_FULL'
                    : 'REQUEST_OUTPUT_FAILED',
            });
      try {
        await emitted.promise;
        expect(calls).toEqual(['start:reasoning-delta']);
        expect(commit).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
      } finally {
        release.resolve();
      }
      await checked;
      if (mode === 'success') {
        expect(calls).toEqual([
          'start:reasoning-delta',
          'end:reasoning-delta',
          'start:text-delta',
          'end:text-delta',
        ]);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        if (engineEmit === undefined) throw new Error('Expected Engine emitter.');
        await expect(engineEmit({ type: 'reasoning-delta', delta: 'late' })).rejects.toMatchObject({
          code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
        });
      } else {
        expect(calls).toEqual(
          mode === 'sink-failure'
            ? ['start:reasoning-delta', 'fail']
            : ['start:reasoning-delta', 'end:reasoning-delta', 'fail']
        );
        expect(commit).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
      }
    }
  );
});
