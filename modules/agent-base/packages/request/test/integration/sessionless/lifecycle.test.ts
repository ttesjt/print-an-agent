import { expect, it } from 'vitest';
import {
  createActor,
  ModelInvocationError,
  type ActorEngineInteractionRequest,
} from '@print-an-agent/model-invocation-core';
import {
  runWithExecutionTimeout,
  skipWorkflow,
  STEP_CARDINALITY,
} from '@print-an-agent/workflow-core';
import { createSessionlessRequestWorkflow } from '../../../src/index.js';
import { assistant, generationActor, outputChannel } from '../../support/sessionless/fixtures.js';

it('drains accepted delivery after Engine failure before publishing failure', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: string[] = [];
  const failure = new ModelInvocationError('MODEL_PROVIDER_FAILED', 'provider failed');
  let lateEmit: ActorEngineInteractionRequest['emit'] | undefined;
  const actor = createActor({
    id: 'failing',
    engine: {
      id: 'fixture',
      capabilities: {
        invocationModes: ['interaction'],
        inputMediaTypes: ['text'],
        interaction: { streamable: true },
        toolCalling: false,
        structuredOutput: false,
        cancellation: true,
      },
      interact: async (request) => {
        lateEmit = request.emit;
        void request.emit({ type: 'text-delta', delta: 'partial' });
        await entered.promise;
        throw failure;
      },
    },
  });
  const workflow = createSessionlessRequestWorkflow({
    mode: 'interaction',
    resources: {
      actor,
      createOutputSink: () => ({
        open: () => Promise.resolve(),
        write: async () => {
          entered.resolve();
          await release.promise;
          events.push('write-settled');
        },
        close: () => {
          events.push('close');
          return Promise.resolve();
        },
        fail: () => {
          events.push('fail');
          return Promise.resolve();
        },
      }),
    },
  });
  let settled = false;
  const pending = workflow.run({ input: { message: 'hello' } }).finally(() => {
    settled = true;
  });
  await entered.promise;
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(events).toEqual([]);
  release.resolve();
  await expect(pending).rejects.toBe(failure);
  expect(events).toEqual(['write-settled', 'fail']);
  await expect(lateEmit?.({ type: 'text-delta', delta: 'late' })).rejects.toBe(failure);
  expect(events).toEqual(['write-settled', 'fail']);
});

it('returns undefined on condition skip without acquiring channels or running hooks', async () => {
  let channels = 0;
  let hooks = 0;
  const workflow = createSessionlessRequestWorkflow({
    mode: 'direct',
    resources: {
      actor: generationActor(),
      createOutputSink: () => {
        channels++;
        return outputChannel([]);
      },
    },
    condition: () => skipWorkflow('caller policy'),
    lifecycle: {
      onFinally: () => {
        hooks++;
      },
    },
  });
  await expect(workflow.run({ input: { message: 'hello' } })).resolves.toBeUndefined();
  expect(channels).toBe(0);
  expect(hooks).toBe(0);
});

it('retains default skip when only cardinality is overridden and reports the actual Workflow name', async () => {
  const events: string[] = [];
  const workflow = createSessionlessRequestWorkflow({
    name: 'website.completion',
    mode: 'direct',
    resources: { actor: generationActor() },
    stepOverrides: { gatherExternalContext: { cardinality: STEP_CARDINALITY.REPEATABLE } },
  });
  await workflow.run({
    input: { message: 'hello' },
    onEvent: (event) => {
      expect(event.workflowName).toBe('website.completion');
      if (event.type === 'step-skipped') events.push(event.stepName);
    },
  });
  expect(events).toContain('gatherExternalContext');
});

it('fails an invocation that built an answer without completing delivery', async () => {
  const events: unknown[] = [];
  const workflow = createSessionlessRequestWorkflow({
    mode: 'direct',
    resources: {
      actor: generationActor(),
      createOutputSink: () => outputChannel(events),
    },
    stepOverrides: { completeResponse: () => Promise.resolve() },
  });
  await expect(workflow.run({ input: { message: 'hello' } })).rejects.toMatchObject({
    code: 'REQUEST_OUTPUT_STATE_INVALID',
  });
  expect(events).toEqual([
    expect.objectContaining({ type: 'opened' }),
    expect.objectContaining({ type: 'failed' }),
  ]);
});

it('bounds empty-message collection overhead including the current prompt', async () => {
  let calls = 0;
  const actor = generationActor({
    complete: () => {
      calls++;
      return Promise.resolve({ message: assistant() });
    },
  });
  const workflow = createSessionlessRequestWorkflow({
    mode: 'direct',
    resources: { actor, policy: { maxContextMessages: 2 } },
  });
  await expect(
    workflow.run({
      input: {
        message: 'hello',
        history: [0, 1].map((timestamp) => ({ role: 'context' as const, text: '', timestamp })),
      },
    })
  ).rejects.toMatchObject({ code: 'REQUEST_INPUT_INVALID' });
  expect(calls).toBe(0);
});

it('preserves Actor timeout ownership under a disabled host deadline', async () => {
  const actor = createActor({
    id: 'bounded',
    invocationPolicy: { timeoutMilliseconds: 2 },
    engine: {
      id: 'fixture',
      capabilities: {
        invocationModes: ['direct'],
        inputMediaTypes: ['text'],
        cancellation: true,
        toolCalling: false,
        structuredOutput: false,
      },
      complete: async (request) => {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        request.signal.throwIfAborted();
        return { message: assistant() };
      },
    },
  });
  const workflow = createSessionlessRequestWorkflow({ mode: 'direct', resources: { actor } });
  await expect(
    runWithExecutionTimeout(
      { parentSignal: new AbortController().signal, timeoutMilliseconds: null },
      (signal) => workflow.run({ input: { message: 'hi' }, signal })
    )
  ).rejects.toMatchObject({ code: 'ACTOR_INVOCATION_TIMEOUT' });
});
