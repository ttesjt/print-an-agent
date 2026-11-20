import { MemoryOutputSink } from '@print-an-agent/base-local-adapters';
import { DEFAULT_REQUEST_POLICY, requireInteractionEvent } from '@print-an-agent/base-request';
import { parseSessionId } from '@print-an-agent/base-session';
import { SKIP_STEP } from '@print-an-agent/workflow-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createDeterministicAgentAPI,
  FOREGROUND_AGENT_OPERATION_NAME,
} from '../../../../src/index.js';
import {
  interactionAgent,
  interactionMessage,
} from '../../../support/runtime/interaction-agent.js';

describe('reasoning streaming', () => {
  it('preserves the reasoning budget error through the real Pi loop and output failure', async () => {
    const output = new MemoryOutputSink();
    const api = createDeterministicAgentAPI({
      identity: { id: 'reasoning-test' },
      requestPolicy: { ...DEFAULT_REQUEST_POLICY, maxReasoningCharacters: 3 },
      provider: {
        responses: [{ status: 'success', text: 'answer', reasoning: 'too long' }],
        charactersPerChunk: 2,
      },
    });
    await expect(api.run({ message: 'hello', outputSink: output })).rejects.toMatchObject({
      code: 'MODEL_REASONING_LIMIT_EXCEEDED',
    });
    expect(output.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'MODEL_REASONING_LIMIT_EXCEEDED' },
    });
  });
  it('separates live reasoning from final text, Session history, replay, and trace content', async () => {
    const histories: string[] = [];
    let sequence = 0;
    const fixture = await interactionAgent(
      async (request) => {
        histories.push(JSON.stringify(request.history));
        await request.emit({ type: 'reasoning-delta', delta: 'PRIVATE_REASONING' });
        await request.emit({ type: 'text-delta', delta: 'AB' });
        const message = interactionMessage();
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
      {
        requestPolicy: { ...DEFAULT_REQUEST_POLICY, maxOutputCharacters: 2 },
        createRunId: () => (++sequence === 1 ? 'interaction-run' : `interaction-run-${sequence}`),
      }
    );
    const response = await fixture.run();
    expect(fixture.output.inspect()).toMatchObject({
      status: 'closed',
      events: [
        { type: 'reasoning-delta', delta: 'PRIVATE_REASONING' },
        { type: 'text-delta', delta: 'AB' },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('PRIVATE_REASONING');
    const session = await fixture.session.inspect({
      agentId: fixture.agent.identity.id,
      sessionId: parseSessionId('session'),
    });
    expect(JSON.stringify(session)).not.toContain('PRIVATE_REASONING');
    const trace = fixture.trace.inspect({ agentRunId: 'interaction-run' }).events;
    expect(JSON.stringify(trace)).not.toContain('PRIVATE_REASONING');
    expect(trace.find((event) => event.type === 'output-publication-completed')).toMatchObject({
      outputCharacters: 2,
    });

    const replay = new MemoryOutputSink();
    await fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
      message: 'start',
      sessionId: 'session',
      idempotencyKey: 'request',
      outputSink: replay,
    });
    expect(replay.inspect()).toMatchObject({ events: [{ type: 'text-delta', delta: 'AB' }] });
    expect(histories).toHaveLength(1);
    await fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
      message: 'next',
      sessionId: 'session',
      outputSink: new MemoryOutputSink(),
    });
    expect(histories).toHaveLength(2);
    expect(histories[1]).toContain('AB');
    expect(histories[1]).not.toContain('PRIVATE_REASONING');
  });

  it.each(['skip', 'override'] as const)(
    'supports %s through the ordinary Step Registry',
    async (mode) => {
      const seen: string[] = [];
      const fixture = await interactionAgent(
        async (request) => {
          for (const delta of ['first', 'second'])
            await request.emit({ type: 'reasoning-delta', delta });
          const message = interactionMessage();
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
        {
          stepOverrides: {
            deliverReasoningDelta:
              mode === 'skip'
                ? SKIP_STEP
                : (context) => {
                    seen.push(requireInteractionEvent(context, 'reasoning-delta').delta);
                    return Promise.resolve();
                  },
          },
        }
      );
      await fixture.run();
      expect(seen).toEqual(mode === 'skip' ? [] : ['first', 'second']);
      expect(fixture.output.inspect()).toMatchObject({ status: 'closed', events: [] });
      const events = fixture.trace.inspect({ agentRunId: 'interaction-run' }).events;
      expect(
        events.filter(
          (event) =>
            event.type === (mode === 'skip' ? 'step-skipped' : 'step-completed') &&
            event.stepName === 'deliverReasoningDelta'
        )
      ).toHaveLength(2);
    }
  );

  it.each(['default', 'skip', 'override'] as const)(
    'enforces cumulative reasoning budget before %s delivery with a stable failure',
    async (mode) => {
      const delivered = vi.fn(() => Promise.resolve());
      const fixture = await interactionAgent(
        async (request) => {
          try {
            for (const delta of ['abc', 'def']) {
              await request.emit({ type: 'turn-start' });
              await request.emit({ type: 'reasoning-delta', delta });
              await request.emit({ type: 'turn-end' });
            }
          } catch {
            /* A swallowed emit rejection must not erase the budget failure. */
          }
          const message = interactionMessage();
          try {
            await request.emit({ type: 'assistant-complete', message });
          } catch {
            /* Return anyway. */
          }
          return { message };
        },
        {
          requestPolicy: { ...DEFAULT_REQUEST_POLICY, maxReasoningCharacters: 5 },
          stepOverrides:
            mode === 'default'
              ? {}
              : { deliverReasoningDelta: mode === 'skip' ? SKIP_STEP : delivered },
        }
      );
      const commit = vi.spyOn(fixture.session, 'completeTurnWithPresentation');
      await expect(fixture.run()).rejects.toMatchObject({ code: 'MODEL_REASONING_LIMIT_EXCEEDED' });
      expect(commit).not.toHaveBeenCalled();
      expect(delivered).toHaveBeenCalledTimes(mode === 'override' ? 1 : 0);
      expect(fixture.output.inspect()).toMatchObject({
        status: 'failed',
        failure: { code: 'MODEL_REASONING_LIMIT_EXCEEDED' },
      });
      expect(fixture.trace.inspect({ agentRunId: 'interaction-run' }).events).toContainEqual(
        expect.objectContaining({
          type: 'agent-loop-failed',
          errorCode: 'MODEL_REASONING_LIMIT_EXCEEDED',
        })
      );
      const replay = new MemoryOutputSink();
      await expect(
        fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
          message: 'start',
          sessionId: 'session',
          idempotencyKey: 'request',
          outputSink: replay,
        })
      ).rejects.toBeDefined();
      expect(replay.inspect()).toMatchObject({
        failure: { code: 'MODEL_REASONING_LIMIT_EXCEEDED' },
      });
    }
  );

  it('allows exactly the configured reasoning limit independently of the text budget', async () => {
    const fixture = await interactionAgent(
      async (request) => {
        await request.emit({ type: 'reasoning-delta', delta: '12345' });
        await request.emit({ type: 'text-delta', delta: 'AB' });
        const message = interactionMessage();
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
      {
        requestPolicy: {
          ...DEFAULT_REQUEST_POLICY,
          maxReasoningCharacters: 5,
          maxOutputCharacters: 2,
        },
      }
    );
    await expect(fixture.run()).resolves.toMatchObject({ message: { text: 'AB' } });
  });

  it('rejects reasoning emitted after terminal without committing the Session', async () => {
    const fixture = await interactionAgent(async (request) => {
      const message = interactionMessage();
      await request.emit({ type: 'assistant-complete', message });
      await request.emit({ type: 'reasoning-delta', delta: 'late' });
      return { message };
    });
    const commit = vi.spyOn(fixture.session, 'completeTurnWithPresentation');
    await expect(fixture.run()).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
    expect(commit).not.toHaveBeenCalled();
    expect(fixture.output.inspect()).toMatchObject({ events: [] });
  });
});
