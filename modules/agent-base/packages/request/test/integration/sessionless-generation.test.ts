import { describe, expect, it } from 'vitest';
import {
  ModelInvocationError,
  type ActorEngineInput,
  type ModelMessage,
} from '@print-an-agent/model-invocation-core';
import { Workflow, SKIP_STEP, runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import {
  createSessionlessRequestWorkflow,
  AgentRequestError,
  type SessionlessOutputSink,
} from '../../src/index.js';
import { assistant, generationActor, outputChannel } from '../support/sessionless.js';

describe('Sessionless Generation', () => {
  it('runs a real Workflow with a completion-only Actor, detached history and no persistence', async () => {
    const calls: unknown[] = [];
    const history: ModelMessage[] = [
      { role: 'context', text: 'facts', timestamp: 0 },
      assistant('earlier'),
    ];
    const workflow = createSessionlessRequestWorkflow({
      mode: 'direct',
      resources: {
        actor: generationActor({
          complete: (request) => {
            calls.push(request);
            return Promise.resolve({ message: assistant(request.messages.at(-1)?.text) });
          },
        }),
        instructionContributors: [() => 'caller instructions'],
        clock: () => 5,
      },
    });
    expect(workflow).toBeInstanceOf(Workflow);
    const first = await workflow.run({ input: { message: 'hello', history } });
    history[0] = { role: 'context', text: 'changed', timestamp: 0 };
    const second = await workflow.run({ input: { message: 'next' } });
    expect(first).toEqual({ message: assistant('hello') });
    expect(second).toEqual({ message: assistant('next') });
    expect(calls).toMatchObject([
      {
        instructions: 'actor instructions\n\ncaller instructions',
        messages: [
          { text: 'facts' },
          { provenance: assistant().provenance },
          { text: 'hello', timestamp: 5 },
        ],
      },
      { messages: [{ text: 'next' }] },
    ]);
    expect(calls).toHaveLength(2);
    expect(first).not.toHaveProperty('sessionId');
  });

  it('streams with a stream-only Actor, per-run channels and independently replaceable Steps', async () => {
    const channels: unknown[][] = [];
    const actor = generationActor({
      stream: async (request) => {
        const text = request.messages.at(-1)?.text ?? '';
        const message = assistant(text);
        await request.emit({ type: 'reasoning-delta', delta: 'think' });
        await request.emit({ type: 'text-delta', delta: text });
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'stream',
      resources: {
        actor,
        createOutputSink: () => {
          const events: unknown[] = [];
          channels.push(events);
          return outputChannel(events);
        },
      },
      stepOverrides: {
        deliverReasoningDelta: SKIP_STEP,
        gatherExternalContext: (context) => {
          context.state.externalContext = [{ role: 'context', text: 'site', timestamp: 0 }];
          return Promise.resolve();
        },
        validateResponse: async (context) => {
          expect(context.state.response?.message.text).toMatch(/one|two/);
          await Promise.resolve();
        },
      },
    });
    await Promise.all(['one', 'two'].map((message) => workflow.run({ input: { message } })));
    expect(channels).toHaveLength(2);
    expect(channels[0]).toMatchObject([
      { type: 'opened' },
      { type: 'text-delta', delta: 'one' },
      { type: 'closed' },
    ]);
    expect(channels[1]).toMatchObject([
      { type: 'opened' },
      { type: 'text-delta', delta: 'two' },
      { type: 'closed' },
    ]);
  });

  it('waits for delivery and reports sink failures without closing successfully', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: unknown[] = [];
    const cause = new Error('private sink diagnostics');
    const actor = generationActor({
      stream: async (request) => {
        void request.emit({ type: 'text-delta', delta: 'answer' });
        await request.emit({ type: 'assistant-complete', message: assistant() });
        return { message: assistant() };
      },
    });
    const workflow = createSessionlessRequestWorkflow({
      mode: 'stream',
      resources: {
        actor,
        createOutputSink: () => ({
          ...outputChannel(events),
          write: async () => {
            started.resolve();
            await release.promise;
            throw cause;
          },
        }),
      },
    });
    let settled = false;
    const pending = workflow.run({ input: { message: 'hello' } }).finally(() => {
      settled = true;
    });
    await started.promise;
    expect(settled).toBe(false);
    expect(events).toHaveLength(1);
    release.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_OUTPUT_FAILED', cause });
    expect(events).toMatchObject([
      { type: 'opened' },
      { type: 'failed', failure: { code: 'REQUEST_OUTPUT_FAILED' } },
    ]);
    expect(JSON.stringify(events)).not.toContain('private sink diagnostics');
  });

  it.each(['open', 'close', 'fail'] as const)(
    'contains %s failure and preserves primary failures',
    async (stage) => {
      const events: unknown[] = [];
      const cause = new Error(stage);
      const sink: SessionlessOutputSink = {
        ...outputChannel(events),
        [stage]: () => Promise.reject(cause),
      };
      const actor = generationActor(
        stage === 'fail'
          ? {
              complete: () =>
                Promise.reject(new ModelInvocationError('MODEL_PROVIDER_FAILED', 'provider')),
            }
          : undefined
      );
      const workflow = createSessionlessRequestWorkflow({
        mode: 'direct',
        resources: { actor, createOutputSink: () => sink },
      });
      const error: unknown = await workflow
        .run({ input: { message: 'hello' } })
        .catch((failure: unknown) => failure);
      if (stage === 'fail') {
        expect(error).toBeInstanceOf(AggregateError);
        expect(error instanceof AggregateError ? error.errors : []).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'MODEL_PROVIDER_FAILED' })])
        );
      } else expect(error).toMatchObject({ code: 'REQUEST_OUTPUT_FAILED', cause });
    }
  );

  it.each(['output', 'reasoning'] as const)(
    'does not bypass %s budgets when display is skipped',
    async (kind) => {
      const actor = generationActor({
        stream: async (request) => {
          await request.emit({
            type: kind === 'output' ? 'text-delta' : 'reasoning-delta',
            delta: 'too long',
          });
          await request.emit({ type: 'assistant-complete', message: assistant('too long') });
          return { message: assistant('too long') };
        },
      });
      const workflow = createSessionlessRequestWorkflow({
        mode: 'stream',
        resources: { actor, policy: { maxOutputCharacters: 2, maxReasoningCharacters: 2 } },
        stepOverrides: { deliverReasoningDelta: SKIP_STEP },
      });
      await expect(workflow.run({ input: { message: 'hello' } })).rejects.toMatchObject({
        code: kind === 'output' ? 'MODEL_OUTPUT_LIMIT_EXCEEDED' : 'MODEL_REASONING_LIMIT_EXCEEDED',
      });
    }
  );

  it('keeps cancellation and owner-specific host deadlines cooperative', async () => {
    const actor = generationActor({
      complete: async (request) => {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        request.signal.throwIfAborted();
        return { message: assistant() };
      },
    });
    const workflow = createSessionlessRequestWorkflow({ mode: 'direct', resources: { actor } });
    await expect(
      runWithExecutionTimeout(
        {
          parentSignal: new AbortController().signal,
          timeoutMilliseconds: 5,
          createTimeoutFailure: () => new AgentRequestError('REQUEST_TIMEOUT', 'host timeout'),
        },
        (signal) => workflow.run({ input: { message: 'hello' }, signal })
      )
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    const controller = new AbortController();
    const reason = new Error('caller');
    controller.abort(reason);
    await expect(
      workflow.run({ input: { message: 'hello' }, signal: controller.signal })
    ).rejects.toBe(reason);
  });

  it('does not retry rejected business output and keeps validation before channel close', async () => {
    let calls = 0;
    const events: unknown[] = [];
    const workflow = createSessionlessRequestWorkflow({
      mode: 'direct',
      resources: {
        actor: generationActor({
          complete: () => {
            calls++;
            return Promise.resolve({ message: assistant() });
          },
        }),
        createOutputSink: () => outputChannel(events),
      },
      stepOverrides: {
        validateResponse: () =>
          Promise.reject(
            new AgentRequestError('REQUEST_OUTPUT_STATE_INVALID', 'invalid application result')
          ),
      },
    });
    await expect(workflow.run({ input: { message: 'hello' } })).rejects.toMatchObject({
      code: 'REQUEST_OUTPUT_STATE_INVALID',
    });
    expect(calls).toBe(1);
    expect(events).toMatchObject([{ type: 'opened' }, { type: 'failed' }]);
  });

  it('rejects unsupported profiles and invalid input/config before model work', async () => {
    let calls = 0;
    const actor = generationActor({
      complete: () => {
        calls++;
        return Promise.resolve({ message: assistant() });
      },
    });
    expect(() =>
      createSessionlessRequestWorkflow({ mode: 'stream', resources: { actor } })
    ).toThrow('Actor does not support');
    for (const policy of [
      { maxMessageCharacters: 0 },
      { maxModelTurns: 1 },
      { timeoutMilliseconds: null },
    ]) {
      expect(() =>
        createSessionlessRequestWorkflow({ mode: 'direct', resources: { actor, policy } })
      ).toThrow();
    }
    const workflow = createSessionlessRequestWorkflow({
      mode: 'direct',
      resources: { actor, policy: { maxContextCharacters: 5 } },
    });
    const cases: unknown[] = [
      { message: 'hi', sessionId: 'no' },
      { message: 'hi', history: null },
      { message: 'hi', history: [{ role: 'system', text: 'bad', timestamp: 0 }] },
      { message: 'longer' },
      {
        get message() {
          throw new Error('getter must not execute');
        },
      },
    ];
    for (const input of cases) {
      // The public TypeScript boundary rejects these shapes; JS ingestion is checked at runtime too.
      await expect(
        Reflect.apply(workflow.run.bind(workflow), workflow, [{ input }])
      ).rejects.toBeInstanceOf(Error);
    }
    expect(calls).toBe(0);
  });

  it('rejects malformed terminal parity through the existing Actor protocol', async () => {
    const stream: NonNullable<ActorEngineInput['stream']> = async (request) => {
      await request.emit({ type: 'assistant-complete', message: assistant('event') });
      return { message: assistant('return') };
    };
    const workflow = createSessionlessRequestWorkflow({
      mode: 'stream',
      resources: { actor: generationActor({ stream }) },
    });
    await expect(workflow.run({ input: { message: 'hi' } })).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
  });
});
