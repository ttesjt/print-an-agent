import type { ModelInteractionEventSink } from '@ta-agent/model-invocation-core';
import {
  DEFAULT_REQUEST_POLICY,
  requireInteractionEvent,
  type DefaultRequestWorkflowContext,
} from '@ta-agent/base-request';
import { parseSessionId } from '@ta-agent/base-session';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultRequestStep,
  interactionAgent,
  interactionMessage,
} from '../support/interaction-agent.js';

describe('interaction Composite Steps', () => {
  it('routes event and result overrides through the registry while preserving authoritative Session data', async () => {
    const calls: string[] = [];
    let contextAfterRun: DefaultRequestWorkflowContext | undefined;
    const fixture = await interactionAgent(
      async (request) => {
        await request.emit({ type: 'text-delta', delta: 'A' });
        await request.emit({ type: 'text-delta', delta: 'B' });
        const message = interactionMessage();
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
      {
        stepOverrides: {
          deliverTextDelta: async (context) => {
            const event = requireInteractionEvent(context, 'text-delta');
            calls.push(event.delta);
            await context.state.request?.outputSink.write({
              type: 'text-delta',
              delta: event.delta.toLowerCase(),
            });
          },
          completeAssistantMessage: async (context) => {
            calls.push('commit');
            await defaultRequestStep('completeAssistantMessage')(context);
          },
          buildAgentResponse: async (context) => {
            calls.push('response');
            contextAfterRun = context;
            await defaultRequestStep('buildAgentResponse')(context);
          },
        },
      }
    );
    await expect(fixture.run()).resolves.toMatchObject({ message: { text: 'AB' } });
    expect(calls).toEqual(['A', 'B', 'commit', 'response']);
    expect(fixture.output.inspect()).toMatchObject({
      status: 'closed',
      events: [
        { type: 'text-delta', delta: 'a' },
        { type: 'text-delta', delta: 'b' },
      ],
    });
    expect(
      await fixture.session.inspect({
        agentId: fixture.agent.identity.id,
        sessionId: parseSessionId('session'),
      })
    ).toMatchObject({ turns: [{ status: 'completed', assistantMessage: { text: 'AB' } }] });
    const context = contextAfterRun;
    if (context === undefined) throw new Error('Expected context.');
    expect(context.state.interaction?.currentEvent).toBeUndefined();
    expect(() => requireInteractionEvent(context, 'text-delta')).toThrowError(
      'Interaction Step requires a current "text-delta" event.'
    );
    await expect(
      context.state.interaction?.emit({ type: 'text-delta', delta: 'late' })
    ).rejects.toMatchObject({ code: 'REQUEST_INTERACTION_EVENT_DELIVERY_CLOSED' });
    const steps = fixture.trace
      .inspect({ agentRunId: 'interaction-run' })
      .events.filter((event) => event.type === 'step-started')
      .map((event) => event.stepName);
    expect(steps.filter((name) => name === 'deliverTextDelta')).toHaveLength(2);
    expect(steps.filter((name) => name === 'dispatchInteractionEvent')).toHaveLength(3);
  });

  it('drains concurrent, unawaited emits before terminal commit and rejects late Engine emission', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let lateEmit: ModelInteractionEventSink | undefined;
    const fixture = await interactionAgent((request) => {
      lateEmit = request.emit;
      void request.emit({ type: 'text-delta', delta: 'A' });
      void request.emit({ type: 'text-delta', delta: 'B' });
      const message = interactionMessage();
      void request.emit({ type: 'assistant-complete', message });
      return Promise.resolve({ message });
    });
    const write = fixture.output.write.bind(fixture.output);
    const commit = vi.spyOn(fixture.session, 'completeTurn');
    const close = vi.spyOn(fixture.output, 'close');
    vi.spyOn(fixture.output, 'write').mockImplementation(async (event) => {
      if (event.delta === 'A') {
        started.resolve();
        await release.promise;
      }
      await write(event);
    });
    const run = fixture.run();
    await started.promise;
    expect(commit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    release.resolve();
    await run;
    expect(fixture.output.inspect()).toMatchObject({
      events: [
        { type: 'text-delta', delta: 'A' },
        { type: 'text-delta', delta: 'B' },
      ],
    });
    expect(commit).toHaveBeenCalledTimes(1);
    if (lateEmit === undefined) throw new Error('Expected Engine callback.');
    await expect(lateEmit({ type: 'turn-end' })).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('keeps a swallowed delivery failure authoritative and never commits a later terminal', async () => {
    const fixture = await interactionAgent(async (request) => {
      try {
        await request.emit({ type: 'text-delta', delta: 'A' });
      } catch {
        /* Engine ignores delivery failure. */
      }
      const message = interactionMessage();
      try {
        await request.emit({ type: 'assistant-complete', message });
      } catch {
        /* Must not turn failure into success. */
      }
      return { message };
    });
    vi.spyOn(fixture.output, 'write').mockRejectedValue(new Error('write failed'));
    const commit = vi.spyOn(fixture.session, 'completeTurn');
    await expect(fixture.run()).rejects.toMatchObject({ code: 'REQUEST_OUTPUT_FAILED' });
    expect(commit).not.toHaveBeenCalled();
    expect(fixture.output.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'REQUEST_OUTPUT_FAILED' },
    });
  });

  it('rejects terminal/result mismatch before the Session Step is invoked', async () => {
    const fixture = await interactionAgent(async (request) => {
      await request.emit({ type: 'assistant-complete', message: interactionMessage('first') });
      return { message: interactionMessage('different') };
    });
    const commit = vi.spyOn(fixture.session, 'completeTurn');
    await expect(fixture.run()).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'overflow'] as const)(
    'coordinates %s with an in-flight write before sink failure',
    async (reason) => {
      const controller = new AbortController();
      const started = Promise.withResolvers<void>();
      const emitted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const calls: string[] = [];
      const fixture = await interactionAgent(
        async (request) => {
          void request.emit({ type: 'text-delta', delta: 'A' });
          await started.promise;
          void request.emit({ type: 'text-delta', delta: 'B' });
          if (reason === 'overflow') void request.emit({ type: 'text-delta', delta: 'overflow' });
          else controller.abort();
          emitted.resolve();
          const message = interactionMessage();
          void request.emit({ type: 'assistant-complete', message });
          return { message };
        },
        { requestPolicy: { ...DEFAULT_REQUEST_POLICY, maxPendingInteractionEvents: 2 } }
      );
      const write = fixture.output.write.bind(fixture.output);
      const fail = fixture.output.fail.bind(fixture.output);
      vi.spyOn(fixture.output, 'write').mockImplementation(async (event) => {
        calls.push(`start:${event.delta}`);
        started.resolve();
        await release.promise;
        await write(event);
        calls.push(`end:${event.delta}`);
      });
      vi.spyOn(fixture.output, 'fail').mockImplementation(async (error) => {
        calls.push('fail');
        await fail(error);
      });
      const run = fixture.run(controller.signal);
      const checked = expect(run).rejects.toMatchObject({
        code:
          reason === 'cancel'
            ? 'MODEL_INVOCATION_CANCELLED'
            : 'REQUEST_INTERACTION_EVENT_QUEUE_FULL',
      });
      await emitted.promise;
      expect(calls).toEqual(['start:A']);
      release.resolve();
      await checked;
      expect(calls).toEqual(['start:A', 'end:A', 'fail']);
    }
  );

  it.each(['delta', 'terminal'] as const)(
    'checks %s budget before custom delivery or Session steps',
    async (mode) => {
      const delivered = vi.fn(() => Promise.resolve());
      const fixture = await interactionAgent(
        async (request) => {
          if (mode === 'delta') await request.emit({ type: 'text-delta', delta: 'too long' });
          const message = interactionMessage('too long');
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
        {
          requestPolicy: { ...DEFAULT_REQUEST_POLICY, maxOutputCharacters: 2 },
          stepOverrides: { deliverTextDelta: delivered },
        }
      );
      const commit = vi.spyOn(fixture.session, 'completeTurn');
      await expect(fixture.run()).rejects.toMatchObject({ code: 'MODEL_OUTPUT_LIMIT_EXCEEDED' });
      expect(delivered).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    }
  );

  it.each([
    'openResponseStream',
    'invokeActorInteraction',
    'completeAssistantMessage',
    'buildAgentResponse',
  ] as const)('closes Tools after failure in %s', async (stepName) => {
    const failure = new Error('step failed');
    const close = vi.fn();
    const fixture = await interactionAgent(
      async (request) => {
        const message = interactionMessage();
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
      {
        stepOverrides: {
          buildTools: async (context) => {
            await defaultRequestStep('buildTools')(context);
            const tools = context.state.tools;
            if (tools === undefined) throw new Error('Expected Tools.');
            context.state.tools = {
              tools: tools.tools,
              execute: tools.execute.bind(tools),
              inspect: tools.inspect.bind(tools),
              close: () => {
                close();
                tools.close();
              },
            };
          },
          [stepName]: () => Promise.reject(failure),
        },
      }
    );
    await expect(fixture.run()).rejects.toBe(failure);
    expect(close).toHaveBeenCalled();
    expect(fixture.output.inspect()).toMatchObject({ status: 'failed' });
    const events = fixture.trace.inspect({ agentRunId: 'interaction-run' }).events;
    expect(events.filter((event) => event.type === 'agent-loop-completed')).toHaveLength(
      stepName === 'buildAgentResponse' ? 1 : 0
    );
    expect(events.filter((event) => event.type === 'agent-loop-failed')).toHaveLength(
      stepName === 'invokeActorInteraction' || stepName === 'completeAssistantMessage' ? 1 : 0
    );
  });
});
