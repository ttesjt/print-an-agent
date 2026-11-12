import { expect, expectTypeOf, it } from 'vitest';
import { createActor, type ActorDirectResult } from '@print-an-agent/model-invocation-core';
import { Workflow } from '@print-an-agent/workflow-core';
import { createSessionlessRequestService } from '../../src/index.js';
import { interactionMessage } from '../support/interaction-agent.js';

const actor = createActor({
  id: 'independent',
  engine: {
    id: 'fixture',
    capabilities: {
      invocationModes: ['direct', 'stream', 'interaction'],
      interaction: { streamable: true },
      inputMediaTypes: ['text'],
      toolCalling: false,
      structuredOutput: false,
      cancellation: true,
    },
    complete: () => Promise.resolve({ message: interactionMessage() }),
    stream: async (request) => {
      await request.emit({ type: 'text-delta', delta: 'AB' });
      await request.emit({ type: 'assistant-complete', message: interactionMessage() });
      return { message: interactionMessage() };
    },
    interact: async (request) => {
      await request.emit({ type: 'assistant-complete', message: interactionMessage() });
      return { message: interactionMessage() };
    },
  },
});

it.each(['direct', 'stream'] as const)(
  'opens a real %s Workflow without an Agent or Session',
  async (mode) => {
    let resolutions = 0;
    const channels: string[][] = [];
    const service = createSessionlessRequestService<{ label: string }>({
      workflow: {
        mode,
        name: 'independent-consumer',
        stepOverrides: {
          resolveInstructions: (context) => {
            context.state.instructions = 'replaced';
            return Promise.resolve();
          },
        },
      },
      resolveResources: ({ target, signal }) => {
        signal.throwIfAborted();
        expect(target.label).toBe('caller-defined');
        resolutions++;
        return {
          actor,
          createOutputSink: () => {
            const events: string[] = [];
            channels.push(events);
            return {
              open: () => Promise.resolve(),
              write: (event) => {
                events.push(event.type);
                return Promise.resolve();
              },
              close: () => {
                events.push('closed');
                return Promise.resolve();
              },
              fail: () => Promise.resolve(),
            };
          },
        };
      },
    });
    expect(resolutions).toBe(0);
    const workflow = await service.open({ label: 'caller-defined' });
    expect(workflow).toBeInstanceOf(Workflow);
    expect(resolutions).toBe(1);
    const results = await Promise.all([
      workflow.run({ input: { message: 'one' } }),
      workflow.run({ input: { message: 'two' } }),
    ]);
    expectTypeOf(results[0]).toEqualTypeOf<ActorDirectResult | undefined>();
    expect(results).toMatchObject([{ message: { text: 'AB' } }, { message: { text: 'AB' } }]);
    expect(channels).toEqual(
      mode === 'stream'
        ? [
            ['text-delta', 'closed'],
            ['text-delta', 'closed'],
          ]
        : [['closed'], ['closed']]
    );
    expect(channels[0]).not.toBe(channels[1]);
  }
);

it('preserves Interaction resource and result types without adding another execution owner', async () => {
  const service = createSessionlessRequestService({
    workflow: { mode: 'interaction' },
    resolveResources: () => ({ actor }),
  });
  const workflow = await service.open('arbitrary-target');
  const result = await workflow.run({ input: { message: 'hello' } });
  expect(result?.toolRun).toMatchObject({ status: 'closed', records: [] });
});

it('retains cancellation before and after resolution and preserves resolver failure identity', async () => {
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let resolutions = 0;
  const service = createSessionlessRequestService({
    workflow: { mode: 'direct' },
    resolveResources: async ({ signal }) => {
      expect(signal).toBe(controller.signal);
      resolutions++;
      entered.resolve();
      await release.promise;
      return { actor };
    },
  });
  const reason = new Error('cancelled');
  const pending = service.open('target', { signal: controller.signal });
  const checked = expect(pending).rejects.toBe(reason);
  await entered.promise;
  controller.abort(reason);
  release.resolve();
  await checked;
  await expect(service.open('target', { signal: controller.signal })).rejects.toBe(reason);
  expect(resolutions).toBe(1);
  const broken = createSessionlessRequestService({
    workflow: { mode: 'direct' },
    resolveResources: () => Promise.reject(reason),
  });
  await expect(broken.open('target')).rejects.toBe(reason);
});

it('rejects unknown/accessor definition fields without invoking them', () => {
  expect(() => {
    Reflect.apply(createSessionlessRequestService, undefined, [
      {
        get workflow() {
          throw new Error('must not execute');
        },
        resolveResources: () => ({ actor }),
      },
    ]);
  }).toThrow('Invalid Sessionless Service definition');
});
