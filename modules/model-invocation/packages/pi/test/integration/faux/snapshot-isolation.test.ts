import { expect, it } from 'vitest';
import {
  createActor,
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  requireCompletionCapability,
} from '@print-an-agent/model-invocation-core';
import { createPiFauxRuntime, type PiFauxRequestSnapshot } from '../../../src/index.js';

it('gives response factories and inspectors separate frozen request snapshots', async () => {
  const observed: PiFauxRequestSnapshot[] = [];
  const profile = createPiFauxRuntime({
    responses: [
      async (snapshot) => {
        observed.push(snapshot);
        await Promise.resolve();
        return { status: 'success', text: 'answer' };
      },
    ],
  });
  const actor = requireCompletionCapability(
    createActor({ id: 'actor', engine: profile.actorEngine })
  );
  await actor.complete({
    instructions: 'instruction',
    messages: [
      defineAssistantModelMessage({
        role: 'assistant',
        text: 'history',
        timestamp: 1,
        stopReason: 'stop',
        provenance: defineProviderModelExecutionProvenance({
          provider: 'prior',
          model: 'prior-model',
        }),
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 3,
        },
      }),
    ],
    maxOutputCharacters: 100,
    signal: new AbortController().signal,
  });
  const factorySnapshot = observed[0];
  const first = profile.inspect();
  const snapshot = first.requests[0];
  const again = profile.inspect().requests[0];
  if (factorySnapshot === undefined || snapshot === undefined || again === undefined)
    throw new Error('Missing captured request');
  expect(snapshot).toEqual(factorySnapshot);
  expect(snapshot).not.toBe(factorySnapshot);
  expect(snapshot).not.toBe(again);
  expect(snapshot.messages).not.toBe(again.messages);
  expect(snapshot).toMatchObject({ callIndex: 1, kind: 'direct', instructions: 'instruction' });
  expect(first).toMatchObject({ callCount: 1, pendingResponseCount: 0 });
  for (const value of [
    first,
    first.requests,
    snapshot,
    snapshot.invocationConfig,
    snapshot.messages,
    snapshot.toolResults,
  ])
    expect(Object.isFrozen(value)).toBe(true);
  const message = snapshot.messages[0];
  const otherMessage = again.messages[0];
  if (message?.role !== 'assistant' || otherMessage?.role !== 'assistant')
    throw new Error('Missing assistant history');
  expect(message.usage).not.toBe(otherMessage.usage);
  expect(Object.isFrozen(message.usage)).toBe(true);
  expect(Reflect.set(message.usage, 'inputTokens', 999)).toBe(false);
  expect(Reflect.set(factorySnapshot, 'instructions', 'changed')).toBe(false);
  expect(profile.inspect().requests[0]).toEqual(snapshot);
});
