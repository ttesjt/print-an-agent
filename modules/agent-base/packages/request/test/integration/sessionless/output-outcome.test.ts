import { expect, it } from 'vitest';
import {
  createSessionlessRequestWorkflow,
  type SessionlessGenerationContext,
  type SessionlessInteractionContext,
} from '../../../src/index.js';
import {
  assistant,
  generationActor,
  interactionActor,
} from '../../support/sessionless/fixtures.js';

it.each(['direct', 'stream', 'interaction'] as const)(
  'keeps a successfully closed %s channel terminal after cancellation or hook failure',
  async (mode) => {
    for (const trigger of ['cancellation', 'hook'] as const) {
      const closeStarted = Promise.withResolvers<void>();
      const releaseClose = Promise.withResolvers<void>();
      const controller = new AbortController();
      const failure = new Error(trigger);
      const events: string[] = [];
      const actor =
        mode === 'interaction'
          ? interactionActor(async (request) => {
              await request.emit({ type: 'assistant-complete', message: assistant() });
              return { message: assistant() };
            })
          : generationActor({
              complete: () => Promise.resolve({ message: assistant() }),
              stream: async (request) => {
                await request.emit({ type: 'assistant-complete', message: assistant() });
                return { message: assistant() };
              },
            });
      const workflow = createSessionlessRequestWorkflow({
        mode,
        resources: {
          actor,
          createOutputSink: () => ({
            open: () => {
              events.push('open');
              return Promise.resolve();
            },
            write: () => Promise.resolve(),
            close: async () => {
              closeStarted.resolve();
              await releaseClose.promise;
              events.push('close');
            },
            fail: () => {
              events.push('fail');
              return Promise.resolve();
            },
          }),
        },
        lifecycle: {
          onSuccess: () => {
            if (trigger === 'hook') throw failure;
          },
          onError: (
            context: SessionlessGenerationContext | SessionlessInteractionContext,
            cause: unknown
          ) => {
            expect(cause).toBe(failure);
            expect(context.state.outputOutcome).toBe('closed');
            events.push('run-failed');
          },
        },
      });
      const pending = workflow.run({ input: { message: 'hi' }, signal: controller.signal });
      const checked = expect(pending).rejects.toBe(failure);
      await closeStarted.promise;
      if (trigger === 'cancellation') controller.abort(failure);
      releaseClose.resolve();
      await checked;
      expect(events).toEqual(['open', 'close', 'run-failed']);
    }
  }
);
