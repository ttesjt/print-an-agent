import { expect, it } from 'vitest';
import {
  createActor,
  requireCompletionCapability,
  requireStreamingCapability,
} from '@print-an-agent/model-invocation-core';
import type {
  ModelInteractionRequest,
  ResolvedExecutionTarget,
} from '@print-an-agent/model-invocation-core';
import { createPiFauxRuntime, createPiProviderRuntime } from '../../../src/index.js';

function request(target: ResolvedExecutionTarget): ModelInteractionRequest {
  return {
    target,
    instructions: '',
    history: [],
    prompt: { role: 'user', text: 'hello', timestamp: 1 },
    tools: { tools: [], execute: () => Promise.resolve({ status: 'success', text: '' }) },
    maxModelTurns: 1,
    maxOutputCharacters: 100,
    signal: new AbortController().signal,
    emit: () => Promise.resolve(),
  };
}

it('rejects foreign and forged targets before invoking Pi while retaining its own target', async () => {
  const first = createPiFauxRuntime({ responses: [{ status: 'success', text: 'first' }] });
  const second = createPiFauxRuntime({ responses: [{ status: 'success', text: 'second' }] });
  const foreign = await first.runtime.resolveTarget(first.modelReference);
  await expect(second.runtime.run(request(foreign))).rejects.toMatchObject({
    code: 'MODEL_RUNTIME_PROTOCOL_INVALID',
  });
  const owned = await second.runtime.resolveTarget(second.modelReference);
  await expect(second.runtime.run(request({ ...owned }))).rejects.toMatchObject({
    code: 'MODEL_RUNTIME_PROTOCOL_INVALID',
  });
  expect(second.inspect().callCount).toBe(0);
  expect((await second.runtime.run(request(owned))).message.text).toBe('second');
  expect(second.inspect().callCount).toBe(1);
});

it('checks target identity and invocation budgets before resolving credentials', async () => {
  let credentialCalls = 0;
  const profile = createPiProviderRuntime({
    provider: {
      kind: 'openai-compatible',
      reference: {
        provider: 'fixture',
        model: 'fixture',
        baseUrl: 'http://127.0.0.1:1/v1',
        credentialRef: 'test:key',
      },
      contextWindowTokens: 4096,
      maxOutputTokens: 256,
      supportsReasoning: false,
      compatibility: { supportsDeveloperRole: false },
    },
    credentialResolver: {
      resolve: () => {
        credentialCalls += 1;
        return Promise.resolve(undefined);
      },
    },
  });
  const target = await profile.runtime.resolveTarget(profile.modelReference);
  await expect(profile.runtime.run(request({ ...target }))).rejects.toMatchObject({
    code: 'MODEL_RUNTIME_PROTOCOL_INVALID',
  });
  await expect(profile.runtime.run({ ...request(target), maxModelTurns: 0 })).rejects.toMatchObject(
    { code: 'MODEL_RUNTIME_PROTOCOL_INVALID' }
  );
  const actor = createActor({ id: 'actor', engine: profile.actorEngine });
  await expect(
    requireCompletionCapability(actor).complete({
      instructions: '',
      messages: [],
      maxOutputCharacters: 0,
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({ code: 'MODEL_RUNTIME_PROTOCOL_INVALID' });
  await expect(
    requireStreamingCapability(actor).stream({
      instructions: '',
      messages: [],
      maxOutputCharacters: 100,
      maxReasoningCharacters: 0,
      signal: new AbortController().signal,
      emit: () => Promise.resolve(),
    })
  ).rejects.toMatchObject({ code: 'MODEL_RUNTIME_PROTOCOL_INVALID' });
  expect(credentialCalls).toBe(0);
});
